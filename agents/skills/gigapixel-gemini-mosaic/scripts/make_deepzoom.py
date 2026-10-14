#!/usr/bin/env python3
"""
make_deepzoom.py — Build a static Microsoft Deep Zoom multi-resolution pyramid + zero-dependency viewer (`deepzoom/`).

Slices any `mosaic.png` / `mosaic.jpg` (`13,334 x 7,500 px = 100.005 MP`) into a multi-level `512 x 512` tile pyramid
so browsers paint the full world in `< 30 ms` (~90 KB base overview) and stream ONLY the visible `512 x 512` blocks at
each zoom level (`0` API calls, ~8 seconds on local CPU).

Usage:
  python /.agents/skills/gigapixel-gemini-mosaic/scripts/make_deepzoom.py --run /tmp/image-run
"""
import argparse, json, math, shutil, time, zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
VIEWER_SRC = Path(__file__).resolve().parent.parent / "viewer"


def save_tile(img: Image.Image, path: Path, quality: int):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="JPEG", quality=quality, subsampling=0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", help="Path to any large PNG/JPG/TIFF image file")
    ap.add_argument("--run", help="World output directory (containing mosaic.png / mosaic.jpg + optional world_plan.json)")
    ap.add_argument("--out", help="Output directory for static Deep Zoom web app (defaults to <run>/deepzoom or <image_dir>/deepzoom)")
    ap.add_argument("--title", default="", help="Optional custom title override")
    ap.add_argument("--tile-size", type=int, default=512)
    ap.add_argument("--quality", type=int, default=92)
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()

    if not a.image and not a.run:
        ap.error("Specify either --image <file> or --run <dir>")

    if a.image:
        src_img = Path(a.image)
        run_dir = src_img.parent
    else:
        run_dir = Path(a.run)
        src_img = run_dir / "mosaic.png"
        if not src_img.exists():
            src_img = run_dir / "mosaic.jpg"
    if not src_img.exists():
        raise FileNotFoundError(f"Image not found: {src_img}")

    t0 = time.time()
    im = Image.open(src_img).convert("RGB")
    w, h = im.size
    max_level = math.ceil(math.log2(max(w, h)))
    min_preload = max(0, max_level - 4)

    out_dir = Path(a.out) if a.out else (run_dir / "deepzoom")
    tiles_dir = out_dir / "tiles"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Save instant <90 KB overview backdrop for immediate first-frame paint + minimap
    ov_w = 1280
    ov_h = round(h * ov_w / w)
    im.resize((ov_w, ov_h), Image.Resampling.LANCZOS).save(out_dir / "overview.jpg", format="JPEG", quality=88)

    # Generate levels from max_level down to min_preload_level using fast progressive 2x halving
    cur = im
    total_tiles = 0
    for z in range(max_level, min_preload - 1, -1):
        lw, lh = cur.size
        cols = math.ceil(lw / a.tile_size)
        rows = math.ceil(lh / a.tile_size)
        jobs = []
        with ThreadPoolExecutor(a.workers) as ex:
            for r in range(rows):
                for c in range(cols):
                    x0, y0 = c * a.tile_size, r * a.tile_size
                    x1, y1 = min(lw, x0 + a.tile_size), min(lh, y0 + a.tile_size)
                    crop = cur.crop((x0, y0, x1, y1))
                    jobs.append(ex.submit(save_tile, crop, tiles_dir / str(z) / f"{c}_{r}.jpg", a.quality))
            for j in jobs:
                j.result()
        total_tiles += len(jobs)
        if z > min_preload:
            cur = cur.resize((max(1, math.ceil(lw / 2)), max(1, math.ceil(lh / 2))), Image.Resampling.LANCZOS)

    # Build interactive neighborhood metadata from world_plan.json + geometry.json if present
    districts = []
    world_name = a.title or src_img.stem
    plan_p, geom_p = run_dir / "world_plan.json", run_dir / "geometry.json"
    if plan_p.exists() and geom_p.exists():
        plan = json.load(open(plan_p))
        geom = json.load(open(geom_p))
        world_name = a.title or plan.get("world_name", world_name)
        for key, box in geom.get("boxes", {}).items():
            d = plan.get("districts", {}).get(key, {})
            districts.append({
                "key": key,
                "title": d.get("title", f"Tile {key}"),
                "scene": d.get("scene", ""),
                "cx": round((box[0] + box[2]) / 2, 1),
                "cy": round((box[1] + box[3]) / 2, 1),
                "box": box,
            })

    manifest = {
        "world_name": world_name,
        "width": w,
        "height": h,
        "tile_size": a.tile_size,
        "format": "jpg",
        "max_level": max_level,
        "min_preload_level": min_preload,
        "total_tiles": total_tiles,
        "districts": districts,
    }
    json.dump(manifest, open(out_dir / "manifest.json", "w"), indent=2)

    for fname in ("index.html", "styles.css", "deepzoom.js"):
        shutil.copy2(VIEWER_SRC / ("styles.txt" if fname == "styles.css" else fname), out_dir / fname)

    (out_dir / 'README.txt').write_text('To open the standalone viewer, extract this archive, run python3 -m http.server 8000 in its directory, and visit http://localhost:8000. The web app also opens deepzoom.zip directly.\n')
    archive_path = out_dir.with_suffix('.zip')
    with zipfile.ZipFile(archive_path, 'w', compression=zipfile.ZIP_STORED) as archive:
        for path in sorted(out_dir.rglob('*')):
            if path.is_file(): archive.write(path, path.relative_to(out_dir).as_posix())

    if archive_path.stat().st_size > 100 * 1024 * 1024:
        raise ValueError('Viewer ZIP exceeds the web viewer 100 MB budget. Repackage with lower viewer JPEG quality; preserve full-resolution originals.')
    total_bytes = sum(f.stat().st_size for f in tiles_dir.rglob("*.jpg"))
    print(
        f"Built Deep Zoom viewer -> {out_dir}/index.html | {total_tiles} tiles ({total_bytes / 1e6:.1f} MB total pyramid) "
        f"levels {min_preload}..{max_level} in {time.time() - t0:.1f}s | stored ZIP: {archive_path}"
    )


if __name__ == "__main__":
    main()
