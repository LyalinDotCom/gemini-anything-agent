#!/usr/bin/env python3
"""qa.py --run DIR — Post-build forensics audit, 1:1 miniature district crops, seam contact sheet, and pass/fail checks."""
import argparse, json, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

ap = argparse.ArgumentParser()
ap.add_argument("--run", required=True)
a = ap.parse_args()

d = Path(a.run)
img = d / "mosaic.png"
(d / "qa").mkdir(exist_ok=True)
here = Path(__file__).parent
subprocess.run([sys.executable, str(here / "forensics.py"), str(img), "--tiles-json", str(d / "forensics_geometry.json"), "--tag", "mosaic", "--out", str(d / "qa")], check=True)

geo = json.load(open(d / "forensics_geometry.json"))
im = Image.open(img).convert("RGB")
W, H = im.size
S = 600
crops = []
for s in geo["seams"]:
    if s["orient"] == "v":
        crops += [im.crop((s["pos"] - S // 2, y - S // 2, s["pos"] + S // 2, y + S // 2)) for y in np.linspace(S, H - S, 4).astype(int)]
    else:
        crops += [im.crop((x - S // 2, s["pos"] - S // 2, x + S // 2, s["pos"] + S // 2)) for x in np.linspace(S, W - S, 6).astype(int)]
cols = 8
rows = (len(crops) + cols - 1) // cols
sheet = Image.new("RGB", (cols * S, rows * S), "white")
for i, c in enumerate(crops):
    sheet.paste(c, ((i % cols) * S, (i // cols) * S))
sheet.save(d / "qa" / "seam_contact_sheet.jpg", quality=82)

cx, cy = W // 2, H // 2
ladder = Image.new("RGB", (3600, 2000), "white")
ladder.paste(im.crop((cx - 900, cy - 500, cx + 900, cy + 500)), (0, 0))
ladder.paste(im.crop((cx - 3600, cy - 2000, cx + 3600, cy + 2000)).resize((1800, 1000), Image.Resampling.LANCZOS), (1800, 0))
ladder.paste(im.resize((1800, round(1800 * H / W)), Image.Resampling.LANCZOS), (0, 1000))
ladder.save(d / "qa" / "zoom_ladder.jpg", quality=88)

for name, (x, y) in {"left": (W // 4, H // 3), "center": (cx, cy), "right": (3 * W // 4, 2 * H // 3)}.items():
    im.crop((x - 900, y - 500, x + 900, y + 500)).save(d / "qa" / f"crop_{name}_1to1.jpg", quality=92)

rep = json.load(open(d / "build_report.json"))
fx = json.load(open(d / "qa" / "mosaic_forensics.json"))
ov = [v["overlap_ncc"] for v in rep.values() if "overlap_ncc" in v]
psnr2 = fx["roundtrip_psnr_db"]["2.0"]
sr = fx.get("seam_ratio_summary", {})
summary = {
    "size": [W, H],
    "mp": round(W * H / 1e6, 3),
    "roundtrip_psnr_2x": psnr2,
    "hf_ratio": fx["spectrum"]["center_crop"]["hf_ratio"],
    "sharpness_lapvar_median": fx["sharpness_lapvar"]["median"],
    "seam_ratio": sr,
    "overlap_ncc_mean": round(float(np.mean(ov)), 3) if ov else None,
    "overlap_ncc_min": round(float(np.min(ov)), 3) if ov else None,
    "seams": [(s["name"], s["ratio"]) for s in fx.get("seams", [])],
    "worst_tiles": sorted(((k, v["overlap_ncc"]) for k, v in rep.items() if "overlap_ncc" in v), key=lambda kv: kv[1])[:5],
}
checks = {
    "detail_psnr2x_le_28": psnr2 <= 28,
    "seam_mean_le_1.10": sr.get("mean", 9) <= 1.10,
    "seam_max_le_1.35": sr.get("max", 9) <= 1.35,
}
summary["checks"] = checks
summary["pass"] = all(checks.values())
summary["manual_visual_review_required"] = True
summary["metric_scope"] = "Broad overlap screening; ratios do not prove that every narrow seam or corner is invisible."
json.dump(summary, open(d / "qa" / "summary.json", "w"), indent=2)
print(json.dumps(summary, indent=2))
print("SCREENING PASS — inspect seams and overlap endpoints visually" if summary["pass"] else "REVIEW NEEDED — see checks; inspect the worst_tiles, regenerate only confirmed failures through the published CLI, then rebuild with --reset")
