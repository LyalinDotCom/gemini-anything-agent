#!/usr/bin/env python3
"""CPU visual-hull reconstruction of existing level-orbit frames; no model calls."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage.measure import marching_cubes
import trimesh


def foreground(image, tolerance):
    rgba = np.asarray(image.convert("RGBA"))
    if np.any(rgba[:, :, 3] < 250):
        return rgba[:, :, 3] >= 128
    rgb = rgba[:, :, :3].astype(np.float32)
    # Background flood fill preserves a light-colored object against white.
    corners = np.concatenate([rgb[:8, :8].reshape(-1, 3), rgb[:8, -8:].reshape(-1, 3),
                              rgb[-8:, :8].reshape(-1, 3), rgb[-8:, -8:].reshape(-1, 3)])
    background = np.median(corners, axis=0)
    near = np.linalg.norm(rgb - background, axis=2) <= tolerance
    seed = np.zeros(near.shape, dtype=bool)
    seed[0, :] = near[0, :]
    seed[-1, :] = near[-1, :]
    seed[:, 0] = near[:, 0]
    seed[:, -1] = near[:, -1]
    mask = ~ndimage.binary_propagation(seed, mask=near)
    mask = ndimage.binary_closing(mask, iterations=2)
    labels, count = ndimage.label(mask)
    if not count:
        return mask
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    return labels == sizes.argmax()


def load_views(args, output):
    paths = sorted(p for p in args.frames.iterdir() if p.suffix.lower() in (".png", ".jpg", ".jpeg"))
    if len(paths) < 12:
        raise ValueError("At least 12 full-orbit views are required; prefer 32–64.")
    if args.angles:
        angles = np.asarray(json.loads(args.angles.read_text()), dtype=float)
        if angles.shape != (len(paths),) or not np.isfinite(angles).all():
            raise ValueError("Angles must be a finite JSON array with one azimuth per frame.")
        gaps = np.diff(np.r_[np.sort(angles % 360), np.sort(angles % 360)[0] + 360])
        if gaps.max() > 45:
            raise ValueError("Azimuth coverage has a gap over 45 degrees; supply a complete orbit.")
    else:
        angles = np.arange(len(paths)) * 360 / len(paths) * (-1 if args.clockwise else 1)
    images, masks, boxes = [], [], []
    mask_dir = output / "masks"
    mask_dir.mkdir(exist_ok=True)
    shape = None
    for path in paths:
        image = Image.open(path).convert("RGBA")
        if max(image.size) > 768:
            image.thumbnail((768, 768), Image.Resampling.LANCZOS)
        rgb = np.asarray(image.convert("RGB"))
        if shape is not None and rgb.shape != shape:
            raise ValueError("Orbit frames have different dimensions.")
        shape = rgb.shape
        if args.masks:
            mask_path = args.masks / (path.stem + ".png")
            mask_image = Image.open(mask_path).convert("L").resize(image.size, Image.Resampling.NEAREST)
            mask = np.asarray(mask_image) >= 128
        else:
            mask = foreground(image, args.background_tolerance)
        y, x = np.where(mask)
        if len(x) < 100 or mask.mean() > 0.85:
            raise ValueError(f"Invalid object segmentation in {path.name}; inspect background or supply a mask.")
        if min(x.min(), y.min()) < 4 or x.max() >= image.width - 4 or y.max() >= image.height - 4:
            raise ValueError(f"Object touches the frame edge in {path.name}; generate more margin.")
        boxes.append([x.min(), y.min(), x.max(), y.max()])
        images.append(rgb)
        masks.append(mask)
        Image.fromarray((mask * 255).astype(np.uint8)).save(mask_dir / (path.stem + ".png"))
    boxes = np.asarray(boxes)
    heights = boxes[:, 3] - boxes[:, 1]
    height = float(np.median(heights))
    if np.ptp(heights) / height > 0.18 or np.ptp((boxes[:, 1] + boxes[:, 3]) / 2) / height > 0.10:
        raise ValueError("Object height/framing changes across the orbit; regenerate a fixed-scale, level orbit.")
    scale = height / 1.6
    center = (shape[1] / 2, float(np.median((boxes[:, 1] + boxes[:, 3]) / 2)))
    horizontal_extent = np.max(np.abs(boxes[:, [0, 2]] - center[0])) / scale
    extent = max(1.0, float(horizontal_extent) * 1.1)
    views = []
    elevation = np.deg2rad(args.elevation)
    for rgb, mask, azimuth in zip(images, masks, np.deg2rad(angles)):
        right = np.array([np.cos(azimuth), np.sin(azimuth), 0])
        camera = np.array([np.sin(azimuth) * np.cos(elevation), -np.cos(azimuth) * np.cos(elevation), np.sin(elevation)])
        up = np.cross(camera, right)
        views.append((rgb, mask, right, up, camera))
    return views, center, scale, extent, paths, angles


def project(points, view, center, scale):
    rgb, _, right, up, _ = view
    col = np.rint(points @ right * scale + center[0]).astype(np.int32)
    row = np.rint(center[1] - points @ up * scale).astype(np.int32)
    valid = (col >= 0) & (col < rgb.shape[1]) & (row >= 0) & (row < rgb.shape[0])
    return np.clip(row, 0, rgb.shape[0] - 1), np.clip(col, 0, rgb.shape[1] - 1), valid


def reconstruct(args):
    output = args.out
    output.mkdir(parents=True, exist_ok=True)
    for name in ("object.glb", "object.ply", "reconstruction.json"):
        if (output / name).exists():
            raise ValueError(f"Refusing to overwrite {output / name}; use a new output directory.")
    views, center, scale, extent, paths, angles = load_views(args, output)
    axis = np.linspace(-extent, extent, args.grid, dtype=np.float32)
    xy = np.stack(np.meshgrid(axis, axis, indexing="ij"), axis=-1).reshape(-1, 2)
    volume = np.zeros((args.grid, args.grid, args.grid), dtype=bool)
    silhouettes = [np.zeros(view[1].shape, dtype=bool) for view in views]
    required = int(np.ceil(len(views) * args.agreement))
    # Carve in slices so memory stays bounded even at high grid resolution.
    for z_index, z in enumerate(axis):
        points = np.column_stack((xy, np.full(len(xy), z, dtype=np.float32)))
        votes = np.zeros(len(points), dtype=np.uint16)
        for view in views:
            row, col, valid = project(points, view, center, scale)
            votes += valid & view[1][row, col]
        kept = votes >= required
        volume[:, :, z_index] = kept.reshape(args.grid, args.grid)
        if kept.any():
            for view, silhouette in zip(views, silhouettes):
                row, col, valid = project(points[kept], view, center, scale)
                silhouette[row[valid], col[valid]] = True
    if volume.sum() < 100:
        raise ValueError("Views do not intersect into a usable object; inspect masks and orbit consistency.")
    ious = []
    for view, silhouette in zip(views, silhouettes):
        # One voxel projects to several pixels; close raster gaps at that scale.
        radius = max(1, int(np.ceil(2 * extent * scale / (args.grid - 1))))
        silhouette = ndimage.binary_closing(silhouette, iterations=radius)
        ious.append(float((silhouette & view[1]).sum() / (silhouette | view[1]).sum()))
    report = {
        "status": "completed", "method": "orthographic silhouette visual hull with projected vertex colors",
        "frames": [p.name for p in paths], "azimuth_degrees": angles.tolist(), "elevation_degrees": args.elevation,
        "grid": args.grid, "required_view_agreement": args.agreement,
        "silhouette_iou": ious, "mean_silhouette_iou": float(np.mean(ious)), "min_silhouette_iou": min(ious),
        "assumptions": ["complete stationary-object orbit", "fixed orthographic scale", "known or assumed camera angles"],
        "limitations": ["unseen surfaces are generated inferences", "concavities not visible in silhouettes are filled",
                        "vertex colors contain reference lighting", "no measured dimensions or camera calibration"]
    }
    if np.mean(ious) < args.min_iou or min(ious) < args.min_iou - 0.15:
        report["status"] = "rejected"
        (output / "reconstruction.json").write_text(json.dumps(report, indent=2) + "\n")
        raise ValueError("Reconstructed silhouettes disagree with the references; see reconstruction.json.")
    # Zero padding closes surfaces even if a long object reaches the grid edge.
    spacing = 2 * extent / (args.grid - 1)
    vertices, faces, _, _ = marching_cubes(np.pad(volume.astype(np.float32), 1), level=0.5, spacing=(spacing,) * 3)
    vertices -= extent + spacing
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=True)
    trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=0.53, iterations=10)
    mesh.fix_normals()
    colors = np.full((len(mesh.vertices), 4), 255, dtype=np.uint8)
    colors[:, :3] = 160
    best = np.full(len(mesh.vertices), -1.0)
    for view in views:
        row, col, valid = project(mesh.vertices, view, center, scale)
        score = mesh.vertex_normals @ view[4]
        visible = valid & ndimage.binary_dilation(view[1], iterations=2)[row, col]
        better = visible & (score > best) & (score > 0)
        colors[better, :3] = view[0][row[better], col[better]]
        best[better] = score[better]
    mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh, vertex_colors=colors)
    report.update(vertices=len(mesh.vertices), faces=len(mesh.faces), watertight=bool(mesh.is_watertight),
                  uncolored_vertex_fraction=float((best < 0).mean()),
                  surface_smoothing="Taubin, 10 iterations", silhouette_iou_stage="voxel hull before surface smoothing")
    if not mesh.is_watertight or not np.isfinite(mesh.vertices).all():
        raise ValueError("Reconstructed surface failed mesh validation.")
    mesh.export(output / "object.ply")
    # glTF uses Y up; Blender's importer converts that back to native Z up.
    gltf_mesh = mesh.copy()
    gltf_mesh.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    # glTF vertex colors are linear; photo pixels and PLY colors are sRGB.
    srgb = colors[:, :3].astype(np.float32) / 255
    linear = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)
    gltf_colors = colors.copy()
    gltf_colors[:, :3] = np.rint(linear * 255).astype(np.uint8)
    gltf_mesh.visual = trimesh.visual.ColorVisuals(mesh=gltf_mesh, vertex_colors=gltf_colors)
    gltf_mesh.export(output / "object.glb")
    (output / "reconstruction.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"glb": str(output / "object.glb"), "vertices": len(mesh.vertices), "mean_iou": report["mean_silhouette_iou"]}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames", type=Path, required=True, help="Evenly spaced full-orbit images, sorted by filename")
    parser.add_argument("--out", type=Path, required=True, help="New output directory")
    parser.add_argument("--masks", type=Path, help="Optional matching <frame stem>.png foreground masks")
    parser.add_argument("--angles", type=Path, help="JSON array of per-frame azimuth angles in degrees")
    parser.add_argument("--clockwise", action="store_true", help="Reverse equally spaced azimuth order")
    parser.add_argument("--elevation", type=float, default=0, help="Fixed camera elevation in degrees")
    parser.add_argument("--grid", type=int, default=160, help="Voxel grid side, 48–256")
    parser.add_argument("--background-tolerance", type=float, default=35, help="RGB distance for border-connected background")
    parser.add_argument("--agreement", type=float, default=0.98, help="Required fraction of silhouettes containing each voxel")
    parser.add_argument("--min-iou", type=float, default=0.8, help="Minimum average silhouette overlap")
    args = parser.parse_args()
    if not 48 <= args.grid <= 256 or not 0.9 <= args.agreement <= 1 or not 0.5 <= args.min_iou <= 1:
        parser.error("grid must be 48–256, agreement 0.9–1, and min-iou 0.5–1")
    if abs(args.elevation) > 30:
        parser.error("The visual-hull baseline requires an orbit elevation within 30 degrees of level")
    try:
        reconstruct(args)
    except (ValueError, OSError) as error:
        # Preserve a rejected quality report; never overwrite a previous run's artifacts.
        args.out.mkdir(parents=True, exist_ok=True)
        report = args.out / "reconstruction.json"
        if not report.exists():
            report.write_text(json.dumps({"status": "failed", "error": str(error)}, indent=2) + "\n")
        parser.exit(1, f"Reconstruction failed: {error}\n")


if __name__ == "__main__":
    main()
