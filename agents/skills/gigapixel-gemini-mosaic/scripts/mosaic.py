#!/usr/bin/env python3
"""Native composition adapted from LyalinDotCom/sergey-image. All model calls stay in published CLIs."""
import argparse, fcntl, hashlib, json, os, resource, sys, time
from pathlib import Path
import numpy as np, cv2
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

Image.MAX_IMAGE_PIXELS = None
COMPOSITION_VERSION = "checkpoint-v3.1-narrow-corners"
TIER_SIZE = {"4K": (5504, 3072), "2K": (2752, 1536), "1K": (1376, 768)}
REF_W = 1376
L_STRENGTH = 0.35         # Luminance lock toward regional guide (prevents sequential left-to-right exposure drift)
CHROMA_STRENGTH = 0.10    # Gentle global hue anchor (preserves 100% of vibrant local pinks, teals, oranges, stripes!)
LOWPASS_SIGMA = 0         # Spatial exposure transfer can imprint a neighbour's different objects.
LOWPASS_L_STRENGTH = 0.0
FEATHER = 6
PYR_LEVELS = 4


def file_sha(path):
    digest=hashlib.sha256()
    with open(path,'rb') as source:
        for chunk in iter(lambda:source.read(1024*1024),b''):digest.update(chunk)
    return digest.hexdigest()

def grid_boxes(cols, rows, tw, th, cw, ch):
    xs = [round(c * (cw - tw) / max(cols - 1, 1)) for c in range(cols)]
    ys = [round(r * (ch - th) / max(rows - 1, 1)) for r in range(rows)]
    return {(r, c): (xs[c], ys[r], xs[c] + tw, ys[r] + th) for r in range(rows) for c in range(cols)}


def load_master(path, inset):
    m = Image.open(path).convert("RGB")
    ix, iy = round(m.width * inset[0]), round(m.height * inset[1])
    return m.crop((ix, iy, m.width - ix, m.height - iy))


def master_crop(master, box, cw, ch):
    sx, sy = master.width / cw, master.height / ch
    x0, y0, x1, y1 = box
    return master.crop((round(x0 * sx), round(y0 * sy), round(x1 * sx), round(y1 * sy)))


def tile_path(d, r, c):
    return d / "tiles" / f"tile_r{r}_c{c}.png"


def ncc(a, b):
    a = a - a.mean()
    b = b - b.mean()
    return float((a * b).mean() / (a.std() * b.std() + 1e-6))


def register(tile_rgb, ref_rgb, tw, th):
    s = 900 / tw
    r_s = cv2.cvtColor(cv2.resize(ref_rgb, None, fx=s, fy=s, interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY).astype(np.float32)
    t_s = cv2.cvtColor(cv2.resize(tile_rgb, None, fx=s, fy=s, interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY).astype(np.float32)
    r_b = cv2.GaussianBlur(r_s, (0, 0), 2)
    t_b = cv2.GaussianBlur(t_s, (0, 0), 2)
    info = {"ncc_before": round(ncc(r_b, t_b), 3)}
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-6)
        _, warp = cv2.findTransformECC(r_b, t_b, warp, cv2.MOTION_AFFINE, crit, None, 5)
        W = warp.copy()
        W[:, 2] /= s
        aligned = cv2.warpAffine(tile_rgb, W, (tw, th), flags=cv2.INTER_LANCZOS4 | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)
        a_s = cv2.cvtColor(cv2.resize(aligned, None, fx=s, fy=s, interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY).astype(np.float32)
        info.update({
            "ncc_after": round(ncc(r_b, cv2.GaussianBlur(a_s, (0, 0), 2)), 3),
            "tx": round(float(W[0, 2]), 1),
            "ty": round(float(W[1, 2]), 1),
            "sx": round(float(np.hypot(W[0, 0], W[1, 0])), 4),
            "sy": round(float(np.hypot(W[0, 1], W[1, 1])), 4),
        })
        if info["ncc_after"] < max(0.2, info["ncc_before"] - 0.01) or abs(info['tx']) > tw*0.05 or abs(info['ty']) > th*0.05 or not (0.92 < info["sx"] < 1.08 and 0.92 < info["sy"] < 1.08):
            aligned = tile_rgb
            info["used"] = "identity"
        else:
            info["used"] = "ecc"
    except cv2.error:
        aligned = tile_rgb
        info["used"] = "identity(ecc failed)"
    return aligned, info


def reinhard_gentle(tile_rgb, ref_rgb, l_strength=L_STRENGTH, c_strength=CHROMA_STRENGTH):
    """Transfer L* luminance to prevent exposure drift while preserving vibrant local cartoon colors (a*, b*)."""
    t = cv2.cvtColor(tile_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    r = cv2.cvtColor(ref_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    out = t.copy()
    for ch, s in ((0, l_strength), (1, c_strength), (2, c_strength)):
        tm, ts = t[..., ch].mean(), t[..., ch].std() + 1e-5
        rm, rs = r[..., ch].mean(), r[..., ch].std() + 1e-5
        out[..., ch] = t[..., ch] * (1 - s) + ((t[..., ch] - tm) * (rs / ts) + rm) * s
    return cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)


def match_luminance_lowpass(tile_rgb, ref_rgb, sigma=LOWPASS_SIGMA, strength=LOWPASS_L_STRENGTH):
    """Lock low-frequency brightness/paper exposure ONLY on Lab L* channel — ZERO RGB chrominance wash-out!"""
    if sigma<=0 or strength<=0: return tile_rgb.astype(np.float32)
    t_lab = cv2.cvtColor(tile_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    r_lab = cv2.cvtColor(ref_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    tl = cv2.GaussianBlur(t_lab[..., 0], (0, 0), sigma)
    rl = cv2.GaussianBlur(r_lab[..., 0], (0, 0), sigma)
    t_lab[..., 0] = np.clip(t_lab[..., 0] + strength * (rl - tl), 0, 255)
    return cv2.cvtColor(t_lab.astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32)


def composite_reference(master, boxes, rc, d, tw, th, cw, ch):
    """Build single reference image: soft macro-terrain guide + sharp native neighbour overlap strips."""
    r, c = rc
    x0, y0, x1, y1 = boxes[rc]
    rw, rh = REF_W, round(REF_W * th / tw)
    # Keep the guide readable without baking a broad blurred stripe into it.
    macro = np.asarray(master_crop(master, boxes[rc], cw, ch).resize((rw, rh), Image.Resampling.LANCZOS), np.float32)
    macro_soft = cv2.GaussianBlur(macro, (0, 0), 4.0)
    base = macro_soft.copy()
    sx, sy = rw / tw, rh / th
    used = []
    for side, nrc in (("top", (r - 1, c)), ("left", (r, c - 1))):
        if nrc not in boxes or not tile_path(d, *nrc).exists():
            continue
        nb = np.asarray(Image.open(tile_path(d, *nrc)).convert("RGB"))
        if nb.shape[1] != tw or nb.shape[0] != th:
            raise ValueError(f'Neighbour {nrc} has size {nb.shape[1]}x{nb.shape[0]}; expected native {tw}x{th}. Regenerate at the correct resolution.')
        # Use real generated pixels. Warping here can invent reflected edges
        # which the model then faithfully copies into the next region.
        nbi = Image.fromarray(nb)
        nx0, ny0, nx1, ny1 = boxes[nrc]
        if side == "left":
            ow = nx1 - x0
            band_w = round(ow * sx)
            patch = np.asarray(nbi.crop((tw - ow, 0, tw, th)).resize((band_w, rh), Image.Resampling.LANCZOS), np.float32)
            # A wide sharp-to-soft fade can be copied into generated artwork.
            # Keep the entire finished overlap sharp; blending happens at build.
            base[:, :band_w] = patch
        else:
            oh = ny1 - y0
            band_h = round(oh * sy)
            patch = np.asarray(nbi.crop((0, th - oh, tw, th)).resize((rw, band_h), Image.Resampling.LANCZOS), np.float32)
            base[:band_h, :] = patch
        used.append(side)
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)), used


def minimum_cost_seam(cost, margin):
    h, w = cost.shape
    dp = cost.copy()
    back = np.zeros((h, w), np.int32)
    for y in range(1, h):
        prev = dp[y - 1]
        shifts = [
            np.pad(prev, (max(0, dx), max(0, -dx)), constant_values=np.inf)[max(0, -dx):w + max(0, -dx)] + abs(dx) * 8.0
            for dx in (-3, -2, -1, 0, 1, 2, 3)
        ]
        st = np.vstack(shifts)
        arg = st.argmin(0)
        dp[y] += st[arg, np.arange(w)]
        back[y] = np.clip(np.arange(w) - (arg - 3), margin, w - margin - 1)
    path = np.zeros(h, np.float32)
    cur = int(dp[-1].argmin())
    path[-1] = cur
    for y in range(h - 1, 0, -1):
        cur = int(back[y, cur])
        path[y - 1] = cur
    return path


def dp_seam_mask_vertical(left, right, feather):
    """Minimum-error seam mask with boundary safety margins and outline avoidance (`mask[:,0]==0`, `mask[:,-1]==1`)."""
    h, w, _ = left.shape
    diff_rgb = np.mean((left - right) ** 2, axis=2)
    gl = cv2.cvtColor(np.clip(left, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    gr = cv2.cvtColor(np.clip(right, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    edge_l = cv2.magnitude(cv2.Sobel(gl, cv2.CV_32F, 1, 0), cv2.Sobel(gl, cv2.CV_32F, 0, 1))
    edge_r = cv2.magnitude(cv2.Sobel(gr, cv2.CV_32F, 1, 0), cv2.Sobel(gr, cv2.CV_32F, 0, 1))
    cost_full = diff_rgb + 2.5 * np.abs(edge_l - edge_r) * (edge_l + edge_r) * 0.05 + 1.5 * (edge_l + edge_r) ** 1.3
    ds = 4
    hs = max(h // ds, 1)
    cost = cost_full[:hs * ds].reshape(hs, ds, w).mean(axis=1)
    margin = min(max(int(feather * 2.2), 64), w // 4)
    xs_norm = np.linspace(-1.0, 1.0, w, dtype=np.float32)
    cost += (xs_norm ** 4)[None, :] * np.percentile(cost, 90) * 0.5
    cost[:, :margin] = np.inf
    cost[:, w - margin:] = np.inf
    path = minimum_cost_seam(cost, margin)
    path_smooth = cv2.GaussianBlur(path.reshape(-1, 1), (1, 9), 0).ravel()
    seam = np.interp(np.linspace(0, hs - 1, h), np.arange(hs), path_smooth)
    xs = np.arange(w, dtype=np.float32)[None, :]
    m = 0.5 * (1.0 + np.tanh((xs - seam[:, None]) / max(feather * 0.65, 1.0)))
    ramp = np.clip(np.arange(w, dtype=np.float32) / max(margin, 1), 0, 1)[None, :]
    m = m * ramp
    m = 1.0 - (1.0 - m) * np.clip(np.arange(w - 1, -1, -1, dtype=np.float32) / max(margin, 1), 0, 1)[None, :]
    return m.astype(np.float32)


def laplacian_blend(a, b, mask_sharp, mask_wide, levels, hard=False):
    if hard: return np.where(mask_sharp[...,None]>=0.5,b,a)
    ga, gb, gms, gmw = [a], [b], [mask_sharp], [mask_wide]
    for _ in range(levels):
        ga.append(cv2.pyrDown(ga[-1]))
        gb.append(cv2.pyrDown(gb[-1]))
        gms.append(cv2.pyrDown(gms[-1]))
        gmw.append(cv2.pyrDown(gmw[-1]))
    la, lb = [], []
    for i in range(levels):
        size = (ga[i].shape[1], ga[i].shape[0])
        la.append(ga[i] - cv2.pyrUp(ga[i + 1], dstsize=size))
        lb.append(gb[i] - cv2.pyrUp(gb[i + 1], dstsize=size))
    la.append(ga[-1])
    lb.append(gb[-1])
    out = None
    for i in range(levels, -1, -1):
        # Keep the same narrow seam at every scale. Wide coarse fades can
        # superpose different objects even when both source images are sharp.
        m = gms[i][..., None]
        cur = la[i] * (1 - m) + lb[i] * m
        out = cur if out is None else cv2.pyrUp(out, dstsize=(cur.shape[1], cur.shape[0])) + cur
    return out


def atomic_json(path, value):
    temp = path.with_suffix(path.suffix + '.tmp')
    with temp.open('w') as handle:
        json.dump(value, handle)
        handle.flush(); os.fsync(handle.fileno())
    temp.replace(path)


def cmd_build(args):
    work = Path(args.run) / '.composition'; work.mkdir(parents=True,exist_ok=True)
    with (work/'lock').open('a') as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise ValueError('Composition is still running; wait before resuming. Do not regenerate inputs.')
        return _cmd_build_unlocked(args)


def _cmd_build_unlocked(args):
    cols, rows = map(int, args.grid.split("x"))
    cw, ch = map(int, args.canvas.split("x"))
    tw, th = TIER_SIZE[args.tier]
    boxes = grid_boxes(cols, rows, tw, th, cw, ch)
    d = Path(args.run)
    missing = [rc for rc in boxes if not tile_path(d, *rc).exists()]
    if missing: raise ValueError(f"Missing generated tiles: {missing}")
    # Validate all native inputs before allocating any full-canvas storage.
    inputs = []
    for rc in sorted(boxes):
        path = tile_path(d, *rc)
        with Image.open(path) as image:
            if image.size != (tw, th):
                raise ValueError(f'Tile {rc} has size {image.size}; expected native {tw}x{th}. No upscaling or stretching is allowed.')
        inputs.append({'rc': list(rc), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'native_size': [tw, th]})
    identity = hashlib.sha256(json.dumps([COMPOSITION_VERSION, cols, rows, tw, th, cw, ch, args.inset, FEATHER, PYR_LEVELS, L_STRENGTH, CHROMA_STRENGTH, LOWPASS_SIGMA, LOWPASS_L_STRENGTH, inputs, hashlib.sha256(Path(args.master).read_bytes()).hexdigest()], sort_keys=True).encode()).hexdigest()
    work = d / '.composition'; work.mkdir(exist_ok=True)
    checkpoint = work / 'state.json'
    previous = json.loads(checkpoint.read_text()) if checkpoint.exists() else None
    canvas_path = work/'canvas.rgb'
    valid_canvas = canvas_path.exists() and canvas_path.stat().st_size == cw*ch*3
    changed = previous is not None and previous['identity'] != identity
    reset = bool(getattr(args,'reset',False) and (changed or (previous and previous['report'] and not valid_canvas)))
    if changed and not reset:
        raise ValueError('Generated inputs or compositor changed. Rebuild with --reset once; completed inputs remain available.')
    if previous and previous['report'] and not valid_canvas and not reset:
        raise ValueError('Composition canvas is missing or truncated. Rebuild with --reset; keep generated inputs.')
    initialize = reset or previous is None or bool(previous.get('initializing',False))
    state = {'identity':identity,'report':{},'initializing':True} if initialize else previous
    if initialize:
        # Commit empty state before touching the canvas: an interrupted reset
        # must never revive old completed regions over a fresh canvas.
        atomic_json(checkpoint,state)
        for path in [work/'pending.json',work/'undo.npy']: path.unlink(missing_ok=True)
        previous_dir=work/'previous';previous_dir.mkdir(exist_ok=True)
        for name in ['mosaic.png','mosaic.jpg','preview_overview.jpg','build_report.json','composition-validation.json','geometry.json','forensics_geometry.json']:
            path=d/name
            if path.exists():path.replace(previous_dir/name)
    report = state['report']
    canvas = np.memmap(canvas_path,dtype=np.uint8,mode='w+' if initialize or not valid_canvas else 'r+',shape=(ch,cw,3))
    if initialize:
        state['initializing']=False;atomic_json(checkpoint,state)
    pending = work / 'pending.json'
    if pending.exists():
        interrupted = json.loads(pending.read_text())
        if interrupted.get('identity') == identity and interrupted['key'] not in report:
            x0, y0, x1, y1 = interrupted['box']
            canvas[y0:y1,x0:x1] = np.load(work/'undo.npy')
            canvas.flush()
        pending.unlink()
    master = load_master(args.master, args.inset)
    batch = getattr(args, 'batch_tiles', 4)
    if not 1 <= batch <= 8: raise ValueError('Composition batches must contain 1 to 8 tiles.')
    processed = 0
    xs = sorted({b[0] for b in boxes.values()})
    ys = sorted({b[1] for b in boxes.values()})
    t0 = time.time()
    for rc in sorted(boxes):
        key = f'{rc[0]},{rc[1]}'
        if key in report: continue
        if processed >= batch: break
        r, c = rc
        x0, y0, x1, y1 = boxes[rc]
        p = tile_path(d, r, c)
        if not p.exists():
            raise ValueError(f"Missing generated tile {rc}; no upscaled master fallback is permitted.")
        else:
            tile = np.asarray(Image.open(p).convert("RGB"))
            if tile.shape[1] != tw or tile.shape[0] != th:
                raise ValueError(f'Tile {rc} has size {tile.shape[1]}x{tile.shape[0]}; expected native {tw}x{th}. No upscaling or stretching is allowed.')
        fmask = np.zeros((th, tw), dtype=bool)
        for done in report:
            box = boxes[tuple(map(int, done.split(',')))]
            ix0, iy0, ix1, iy1 = max(x0,box[0]), max(y0,box[1]), min(x1,box[2]), min(y1,box[3])
            if ix0 < ix1 and iy0 < iy1: fmask[iy0-y0:iy1-y0,ix0-x0:ix1-x0] = True
        region = canvas[y0:y1, x0:x1]
        guide = np.asarray(master_crop(master, boxes[rc], cw, ch).resize((tw,th),Image.Resampling.LANCZOS))
        comp = np.where(fmask[..., None], region, guide)
        aligned, info = register(tile, comp, tw, th)
        info['native_size'] = [tile.shape[1], tile.shape[0]]
        aligned = reinhard_gentle(aligned, comp)
        new = match_luminance_lowpass(aligned, comp) if LOWPASS_SIGMA else aligned.astype(np.float32)
        mask = np.ones((th, tw), np.float32)
        mask_wide = np.ones((th, tw), np.float32)
        if c > 0:
            ow = xs[c - 1] + tw - x0
            mask[:, :ow] = np.minimum(mask[:, :ow], dp_seam_mask_vertical(region[:, :ow], new[:, :ow], FEATHER))
            cw_ramp = (0.5 * (1.0 - np.cos(np.pi * np.linspace(0.0, 1.0, ow, dtype=np.float32))))[None, :]
            mask_wide[:, :ow] = np.minimum(mask_wide[:, :ow], cw_ramp)
        if r > 0:
            oh = ys[r - 1] + th - y0
            m = dp_seam_mask_vertical(np.transpose(region[:oh], (1, 0, 2)), np.transpose(new[:oh], (1, 0, 2)), FEATHER).T
            mask[:oh] = np.minimum(mask[:oh], m)
            ch_ramp = (0.5 * (1.0 - np.cos(np.pi * np.linspace(0.0, 1.0, oh, dtype=np.float32))))[:, None]
            mask_wide[:oh] = np.minimum(mask_wide[:oh], ch_ramp)
        # Eliminate T-junction vertical cuts at right/bottom tile edges where canvas already contains finished artwork (`fmask == True`)
        if x1 < cw and fmask[:, -1].any():
            tw_fade = min(tw // 3, 2 * FEATHER)
            r_taper = (0.5 * (1.0 + np.cos(np.pi * np.linspace(0.0, 1.0, tw_fade, dtype=np.float32))))[None, :]
            rows_f = fmask[:, -1]
            mask[rows_f, -tw_fade:] = np.minimum(mask[rows_f, -tw_fade:], r_taper)
            mask_wide[rows_f, -tw_fade:] = np.minimum(mask_wide[rows_f, -tw_fade:], r_taper)
        mask[~fmask] = 1.0
        mask_wide[~fmask] = 1.0
        ph = (-th) % (2 ** PYR_LEVELS)
        pw = (-tw) % (2 ** PYR_LEVELS)
        A = cv2.copyMakeBorder(np.where(fmask[..., None], region, new), 0, ph, 0, pw, cv2.BORDER_REFLECT)
        B = cv2.copyMakeBorder(new, 0, ph, 0, pw, cv2.BORDER_REFLECT)
        M = cv2.copyMakeBorder(mask, 0, ph, 0, pw, cv2.BORDER_REFLECT)
        Mw = cv2.copyMakeBorder(mask_wide, 0, ph, 0, pw, cv2.BORDER_REFLECT)
        if fmask.any():
            g1 = cv2.cvtColor(np.clip(region, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
            g2 = cv2.cvtColor(aligned, cv2.COLOR_RGB2GRAY).astype(np.float32)
            info["overlap_ncc"] = round(ncc(g1[fmask], g2[fmask]), 3)
        with (work/'undo.npy').open('wb') as undo:
            np.save(undo,np.array(region));undo.flush();os.fsync(undo.fileno())
        atomic_json(pending,{'key':key,'box':[x0,y0,x1,y1],'identity':identity})
        selected_ncc = info.get('ncc_after',0) if info['used']=='ecc' else info['ncc_before']
        result = laplacian_blend(A, B, M, Mw, PYR_LEVELS, hard=selected_ncc<0.2)[:th, :tw]
        canvas[y0:y1, x0:x1] = np.clip(result,0,255).astype(np.uint8)
        canvas.flush()
        report[key] = info
        state['report'] = report
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 if sys.platform == 'darwin' else 1)
        state['peak_rss_kib'] = max(state.get('peak_rss_kib',0),int(rss))
        atomic_json(checkpoint,state)
        pending.unlink()
        processed += 1
        del tile, aligned, new, mask, mask_wide, A, B, M, Mw, result, comp, guide, fmask, region
        print(f"placed ({r},{c}) {info}", flush=True)
    if processed or len(report) < len(boxes):
        print(json.dumps({'status':'pending','completed_tiles':len(report),'total_tiles':len(boxes),'next':'Repeat build in a new code-execution call WITHOUT --reset; it resumes automatically and finishes in a separate call.'}),flush=True)
        return {'status':'pending','completed_tiles':len(report)}
    im = Image.fromarray(canvas)
    im.save(d / ".mosaic.tmp", format="PNG", compress_level=6)
    (d / ".mosaic.tmp").replace(d / "mosaic.png")
    im.save(d / ".mosaic-jpeg.tmp",format="JPEG",quality=95,subsampling=0)
    (d / ".mosaic-jpeg.tmp").replace(d / "mosaic.jpg")
    im.resize((2000, round(2000 * ch / cw)), Image.Resampling.LANCZOS).save(d / ".preview.tmp",format="JPEG",quality=92)
    (d / ".preview.tmp").replace(d / "preview_overview.jpg")
    seams = []
    for c in range(1, cols):
        a, b = xs[c], xs[c - 1] + tw
        seams.append({"orient": "v", "pos": (a + b) // 2, "halfwidth": (b - a) // 2, "start": 0, "end": ch, "name": f"v{c-1}"})
    for r in range(1, rows):
        a, b = ys[r], ys[r - 1] + th
        seams.append({"orient": "h", "pos": (a + b) // 2, "halfwidth": (b - a) // 2, "start": 0, "end": cw, "name": f"h{r-1}"})
    atomic_json(d/"geometry.json",{"boxes": {f"{r},{c}":list(box) for (r,c),box in boxes.items()}})
    tiles = [{"name": f"r{r}_c{c}", "x0": b[0], "y0": b[1], "x1": b[2], "y1": b[3]} for (r, c), b in boxes.items()]
    atomic_json(d/"forensics_geometry.json",{"seams":seams,"tiles":tiles})
    atomic_json(d/"build_report.json",report)
    ov = [v["overlap_ncc"] for v in report.values() if "overlap_ncc" in v] or [1.0]
    atomic_json(d/"composition-validation.json",{"status":"completed","identity":identity,"mosaic_sha256":file_sha(d/"mosaic.png"),"size":[cw,ch],"generated_tiles":len(inputs),"native_inputs":inputs,"checkpointed":True,"disk_backed_canvas":True,"peak_rss_kib":max(state.get("peak_rss_kib",0),int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/(1024 if sys.platform=="darwin" else 1)))})
    completed={'status':'completed','size':[cw,ch],'megapixels':round(cw*ch/1e6,3),'generated_tiles':len(inputs),'elapsed_seconds':round(time.time()-t0,1),'overlap_ncc_mean':float(np.mean(ov))}
    print(json.dumps(completed),flush=True)
    return completed



def validate_geometry(cols,rows,tw,th,cw,ch):
    if min(cols,rows,tw,th,cw,ch)<=0 or cw<tw or ch<th or cw>cols*tw or ch>rows*th:
        raise ValueError('Invalid canvas/grid: generated tiles must cover it without upscaling.')
    if (cols>1 and (cols*tw-cw)/(cols-1)<128) or (rows>1 and (rows*th-ch)/(rows-1)<128):
        raise ValueError('Tiles need at least 128 pixels of overlap per seam for seamless assembly.')


def cmd_reference(args):
    cols,rows=map(int,args.grid.split('x'));cw,ch=map(int,args.canvas.split('x'));tw,th=TIER_SIZE[args.tier]
    validate_geometry(cols,rows,tw,th,cw,ch)
    r,c=map(int,args.tile.split(','))
    if not (0<=r<rows and 0<=c<cols): raise ValueError('Tile outside grid')
    d=Path(args.run);(d/'tiles').mkdir(parents=True,exist_ok=True)
    plan=json.loads(Path(args.plan).read_text());boxes=grid_boxes(cols,rows,tw,th,cw,ch)
    for nr,nc in [(r-1,c),(r,c-1)]:
        if nr>=0 and nc>=0 and not tile_path(d,nr,nc).exists():
            raise ValueError('Generate top and left neighbours before this reference.')
    reference,bands=composite_reference(load_master(args.master,args.inset),boxes,(r,c),d,tw,th,cw,ch)
    path=d/'tiles'/f'ref_r{r}_c{c}.png';reference.save(path)
    scene=plan['districts'][f'{r},{c}']
    continuity = (f"The {' and '.join(bands)} portions contain finished neighbouring artwork: continue every line, landscape feature, lighting and subject scale across those boundaries. " if bands else "This first region has a soft composition guide; render it with crisp native detail. ")
    prompt=(f"Image 1 is the regional composition and neighbour continuity guide for '{scene['title']}'. "
      f"Render this region with crisp native detail: {scene['scene']} "
      f"Match this style and palette exactly: {plan['style']}. {plan.get('style_rules','')} "
      f"{continuity}"
      "Soft areas are layout guides only: redraw them with crisp native detail. Never reproduce reference blur, fades, ghosted outlines or a sharp-to-soft transition. "
      "Keep the depicted geographic region and camera perspective; do not replace the crop with the whole composition. No tile border, captions, watermark or extra text.")
    record={'rc':[r,c],'box':boxes[(r,c)],'reference':str(path),'output':str(tile_path(d,r,c)),'prompt':prompt,'bands':bands,'tier':args.tier,'expected_size':[tw,th],'aspect_ratio':'16:9'}
    (d/'tiles'/f'request_r{r}_c{c}.json').write_text(json.dumps(record,indent=2))
    print(json.dumps(record))


def main():
    ap=argparse.ArgumentParser(description='Native references and seamless composition from existing images; no model calls.')
    ap.add_argument('cmd',choices=['reference','build'])
    ap.add_argument('--run',required=True);ap.add_argument('--plan');ap.add_argument('--master',required=True)
    ap.add_argument('--canvas',default='13334x7500');ap.add_argument('--grid',default='7x7');ap.add_argument('--tier',default='2K',choices=list(TIER_SIZE))
    ap.add_argument('--batch-tiles',type=int,default=4,help='At most this many composition regions per invocation; repeat the command to resume.')
    ap.add_argument('--reset',action='store_true',help='Restart composition after changing generated inputs; preserves source images.')
    ap.add_argument('--tile');ap.add_argument('--inset',type=lambda s:tuple(map(float,s.split(','))),default=(.02,.025))
    args=ap.parse_args()
    cols,rows=map(int,args.grid.split('x'));cw,ch=map(int,args.canvas.split('x'));tw,th=TIER_SIZE[args.tier]
    validate_geometry(cols,rows,tw,th,cw,ch)
    if args.cmd=='reference':
        if not args.plan or not args.tile:ap.error('reference requires --plan and --tile')
        cmd_reference(args)
    else:cmd_build(args)

if __name__=='__main__':main()
