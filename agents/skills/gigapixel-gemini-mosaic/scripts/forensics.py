#!/usr/bin/env python3
"""
forensics.py — Objective measurements verifying true high-frequency gigapixel detail and seamless stitching.
"""
import argparse, json, math, time
from pathlib import Path
import numpy as np, cv2
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def psnr(a, b):
    total = 0.0
    for y in range(0,a.shape[0],128):
        delta = a[y:y+128].astype(np.float32)-b[y:y+128].astype(np.float32)
        total += float(np.sum(delta*delta,dtype=np.float64))
    mse = total/a.size
    return 99.0 if mse == 0 else 10 * math.log10(255.0 ** 2 / mse)


def roundtrip_psnr(gray, f):
    h, w = gray.shape
    small = cv2.resize(gray, (max(1, int(round(w / f))), max(1, int(round(h / f)))), interpolation=cv2.INTER_AREA)
    back = cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)
    return psnr(gray, back)


def hf_energy_ratio(gray_crop):
    g = gray_crop.astype(np.float64) - gray_crop.mean()
    P = np.abs(np.fft.fftshift(np.fft.fft2(g))) ** 2
    h, w = P.shape
    cy, cx = h // 2, w // 2
    yy, xx = np.ogrid[:h, :w]
    r = np.sqrt(((yy - cy) / (h / 2)) ** 2 + ((xx - cx) / (w / 2)) ** 2)
    total = P[r <= 1.0].sum()
    return float(P[(r > 0.5) & (r <= 1.0)].sum() / total), float(P[(r > 0.25) & (r <= 0.5)].sum() / total)


def sharpness_map(gray, block=256):
    h, w = gray.shape
    rows, cols = h // block, w // block
    m = np.zeros((rows, cols), dtype=np.float64)
    for r in range(rows):
        for c in range(cols):
            m[r, c] = cv2.Laplacian(gray[r * block:(r + 1) * block, c * block:(c + 1) * block], cv2.CV_64F).var()
    return m


def grad_mag(gray):
    return cv2.magnitude(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--tiles-json")
    ap.add_argument("--out", default="forensics_out")
    ap.add_argument("--tag", default=None)
    ap.add_argument("--crop", type=int, default=2048)
    args = ap.parse_args()

    t0 = time.time()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    tag = args.tag or Path(args.image).stem
    im = Image.open(args.image).convert("RGB")
    W, H = im.size
    rgb = np.asarray(im)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    del rgb, im
    mp = W * H / 1e6
    res = {"image": args.image, "width": W, "height": H, "megapixels": round(mp, 3)}

    rt = {str(f): round(roundtrip_psnr(gray, f), 2) for f in (1.5, 2.0, 3.0, 4.0, 6.0)}
    res["roundtrip_psnr_db"] = rt
    fstar = max([1.0] + [f for f in (1.5, 2.0, 3.0, 4.0, 6.0) if rt[str(f)] >= 38.0])
    res["eff_resolution_factor"] = fstar
    res["eff_mp_est_psnr38"] = round(mp / (fstar ** 2), 2)

    cs = min(args.crop, W, H)
    y0, x0 = (H - cs) // 2, (W - cs) // 2
    crop = gray[y0:y0 + cs, x0:x0 + cs]
    hf, mid = hf_energy_ratio(crop)
    res["spectrum"] = {"center_crop": {"hf_ratio": hf, "mid_ratio": mid}}

    sm = sharpness_map(gray, 256)
    res["sharpness_lapvar"] = {
        "min": float(sm.min()), "p10": float(np.percentile(sm, 10)), "median": float(np.median(sm)),
        "p90": float(np.percentile(sm, 90)), "max": float(sm.max()), "soft_block_fraction_lt_50": float((sm < 50).mean()),
    }
    norm = (255 * np.clip(sm / max(np.percentile(sm, 99), 1e-6), 0, 1)).astype(np.uint8)
    cv2.imwrite(str(out / f"{tag}_sharpness_heatmap.png"), cv2.applyColorMap(cv2.resize(norm, (sm.shape[1] * 8, sm.shape[0] * 8), interpolation=cv2.INTER_NEAREST), cv2.COLORMAP_INFERNO))

    if args.tiles_json:
        geo = json.load(open(args.tiles_json))
        seam_stats = []
        flank = 128
        for s in geo.get("seams", []):
            band = int(s.get("halfwidth", 24))
            if s["orient"] == "v":
                x = int(s["pos"]); a, b = int(s["start"]), int(s["end"])
                lo,hi=max(0,x-band-flank),min(W,x+band+flank)
                gm=grad_mag(gray[a:b,lo:hi])
                left,right=max(0,x-band-lo),min(hi-lo,x+band-lo)
                seam_band=gm[:,left:right];c1=gm[:,:left];c2=gm[:,right:]
            else:
                y = int(s["pos"]); a, b = int(s["start"]), int(s["end"])
                lo,hi=max(0,y-band-flank),min(H,y+band+flank)
                gm=grad_mag(gray[lo:hi,a:b])
                top,bottom=max(0,y-band-lo),min(hi-lo,y+band-lo)
                seam_band=gm[top:bottom,:];c1=gm[:top,:];c2=gm[bottom:,:]
            ctrl_mean = float(np.mean([c.mean() for c in (c1, c2) if c.size > 0]))
            seam_mean = float(seam_band.mean())
            seam_stats.append({**s, "seam_grad": round(seam_mean, 2), "ctrl_grad": round(ctrl_mean, 2), "ratio": round(seam_mean / max(ctrl_mean, 1e-6), 3)})
        res["seams"] = seam_stats
        if seam_stats:
            ratios = [s["ratio"] for s in seam_stats]
            res["seam_ratio_summary"] = {"mean": round(float(np.mean(ratios)), 3), "max": round(float(np.max(ratios)), 3), "n": len(ratios)}

    res["elapsed_s"] = round(time.time() - t0, 1)
    json.dump(res, open(out / f"{tag}_forensics.json", "w"), indent=2)
    print(json.dumps({k: v for k, v in res.items() if k not in ("seams",)}, indent=2))


if __name__ == "__main__":
    main()
