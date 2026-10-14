#!/usr/bin/env python3
"""Prepare transparent photographic textures from existing Gemini images; no model calls."""
import argparse
import hashlib
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def isolate(image, tolerance=32):
    rgba = np.asarray(image.convert('RGBA')).copy()
    if np.any(rgba[:, :, 3] < 250):
        alpha = rgba[:, :, 3].astype(np.float32) / 255
    else:
        rgb = rgba[:, :, :3].astype(np.float32)
        corners = np.concatenate([rgb[:8, :8].reshape(-1, 3), rgb[:8, -8:].reshape(-1, 3), rgb[-8:, :8].reshape(-1, 3), rgb[-8:, -8:].reshape(-1, 3)])
        background = np.median(corners, axis=0)
        distance = np.linalg.norm(rgb - background, axis=2)
        near = distance < tolerance
        # Chroma backgrounds stay the same hue through studio shading. Removing
        # their shadows by hue avoids forcing a large RGB tolerance onto faces.
        if np.ptp(background) > 80 and background.min() < background.max()*.5:
            norm = np.linalg.norm(rgb, axis=2)
            direction = rgb / np.maximum(norm[:,:,None], 1)
            bg_direction = background / max(float(np.linalg.norm(background)), 1)
            near |= (np.linalg.norm(direction-bg_direction, axis=2) < .18) & (norm > 1)

        seed = np.zeros(near.shape, dtype=bool)
        seed[0] = near[0]; seed[-1] = near[-1]; seed[:, 0] = near[:, 0]; seed[:, -1] = near[:, -1]
        exterior = ndimage.binary_propagation(seed, mask=near)
        mask = ~exterior
        labels, count = ndimage.label(mask)
        if not count:
            raise ValueError('No foreground found. Supply an isolated image or an alpha PNG.')
        sizes = np.bincount(labels.ravel()); sizes[0] = 0
        mask = labels == sizes.argmax()
        # Keep opaque photo pixels unchanged. Only soften the outermost edge.
        inside = ndimage.distance_transform_edt(mask)
        alpha = np.clip(inside / 1.4, 0, 1).astype(np.float32)
        # Remove the solid-background contribution from partially transparent edge pixels.
        edge = (alpha > 0) & (alpha < 1)
        if edge.any():
            a = alpha[edge, None]
            rgba[edge, :3] = np.clip((rgb[edge] - (1-a)*background) / a, 0, 255).astype(np.uint8)
    rgba[:, :, 3] = np.rint(alpha * 255).astype(np.uint8)
    y, x = np.where(alpha > 0.1)
    if len(x) < 100 or alpha.mean() > 0.85:
        raise ValueError('Invalid foreground. Inspect isolation before continuing.')
    if min(x.min(), y.min()) < 3 or x.max() >= image.width-3 or y.max() >= image.height-3:
        raise ValueError('Subject is clipped; generate an isolated reference with more margin.')
    return Image.fromarray(rgba), (int(x.min()), int(y.min()), int(x.max()+1), int(y.max()+1))


def validate_coverage(path, paths):
    if not path:
        raise ValueError('3D View requires --coverage: inspected angles, not evenly timed frames.')
    coverage = json.loads(path.read_text())
    if not isinstance(coverage, dict) or not isinstance(coverage.get('asymmetric_subject', True), bool):
        raise ValueError('Coverage must be an object with a boolean asymmetric_subject classification.')
    if coverage.get('azimuth_sign', 1) not in (-1, 1) or isinstance(coverage.get('azimuth_sign'), bool):
        raise ValueError('azimuth_sign must be +1 or -1.')
    views = coverage.get('views', [])
    angles = [view.get('angle_degrees') for view in views]
    if len(views) != len(paths) or any(view.get('file') != file.name for view, file in zip(views, paths)):
        raise ValueError('Coverage entries must match every ordered frame filename.')
    if any(isinstance(angle, bool) or not isinstance(angle, (int, float)) or not np.isfinite(angle) for angle in angles):
        raise ValueError('Each inspected view needs a finite numeric angle.')
    if angles[0] != 0 or angles[-1] >= 360 or any(b <= a or b-a > 30 for a, b in zip(angles, angles[1:])) or 360-angles[-1] > 30:
        raise ValueError('Angles must cover 0–360 in one direction with no reversal or gaps above 30 degrees.')
    evidence = coverage.get('evidence', {})
    if not isinstance(evidence, dict):
        raise ValueError('Coverage evidence must map orientations to frame filenames.')
    for label, target in [('front',0), ('first_profile',90), ('back',180), ('opposite_profile',270)]:
        file = evidence.get(label)
        indices = [index for index, item in enumerate(paths) if item.name == file]
        if not indices or abs(angles[indices[0]]-target) > 15:
            raise ValueError(f'Missing inspected {label} evidence near {target} degrees.')
    return coverage, angles


def align_views(prepared, size):
    """Align existing photographic alpha crops; no generated pixels or 3D inference."""
    crops = [image.crop(image.getchannel('A').getbbox()) for image, _ in prepared]
    ratios = [image.width/image.height for image in crops]
    target_height = max(1, round(min(size*.86, size*.86/max(ratios))))
    margin = max(4, round(size*.025))
    width = round(target_height*max(ratios)) + margin*2
    height = target_height + margin*2
    aligned = []
    for crop in crops:
        crop = crop.resize((max(1, round(crop.width*target_height/crop.height)), target_height), Image.Resampling.LANCZOS)
        canvas = Image.new('RGBA', (width, height))
        x = (width-crop.width)//2
        canvas.paste(crop, (x, margin))
        aligned.append((canvas, (x, margin, x+crop.width, margin+target_height)))
    return aligned


def reject_retraced_views(prepared, coverage):
    # An asymmetric subject (person holding a cat) must reveal different opposite
    # sides. Symmetric products are excluded: matching sides can be legitimate.
    if not coverage.get('asymmetric_subject', True):
        return
    descriptors = []
    for image, _ in prepared:
        pixels = np.asarray(image.resize((64, 128), Image.Resampling.LANCZOS)).astype(np.float32) / 255
        descriptors.append(pixels[:, :, :3] * pixels[:, :, 3, None])
    distance = lambda a, b: float(np.abs(a-b).mean())
    n = len(descriptors)
    angles = [view['angle_degrees'] for view in coverage.get('views', [])] or [i*360/n for i in range(n)]
    adjacent = np.median([distance(descriptors[i], descriptors[(i+1) % n]) for i in range(n)])
    first = [i for i, angle in enumerate(angles) if 45 <= angle <= 135]
    second = [i for i, angle in enumerate(angles) if 180 < angle < 360]
    retraced = np.median([min(distance(descriptors[i], descriptors[j]) for j in second) for i in first])
    mirrored = min(distance(descriptors[i][:, ::-1], descriptors[j]) for i in first for j in second)
    if adjacent > .005 and retraced < adjacent * 1.2:
        raise ValueError('Detected likely out-and-back views of an asymmetric subject; regenerate the opposite side rather than relabeling time as angles.')
    if mirrored < .0001:
        raise ValueError('Detected a mirrored copy of an asymmetric view; generate the actual opposite side.')


def clean_invisible_colors(image):
    """Bleed edge colours into invisible pixels to avoid filtered background halos."""
    pixels = np.asarray(image).copy()
    invisible = pixels[:, :, 3] == 0
    distance, indices = ndimage.distance_transform_edt(invisible, return_indices=True)
    near = invisible & (distance <= 3)
    pixels[invisible, :3] = 0
    pixels[near, :3] = pixels[indices[0][near], indices[1][near], :3]
    return Image.fromarray(pixels)


def prepare(args):
    paths = [args.image] if args.image else sorted((p for p in args.frames.iterdir() if p.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp')), key=lambda p: [int(part) if part.isdigit() else part for part in re.split(r'(\d+)', p.name)])
    if not paths or (args.frames and len(paths) < 16):
        raise ValueError('A view object needs at least 16 ordered views; a cutout needs one image.')
    coverage, angles = validate_coverage(args.coverage, paths) if args.frames else (None, [0])
    out = args.out.resolve()
    if (out / 'photo-object.json').exists():
        raise ValueError('Use a new output directory; an object already exists here.')
    out.mkdir(parents=True, exist_ok=True)
    prepared = []
    for path in paths:
        with Image.open(path) as image:
            image = image.convert('RGBA')
            if max(image.size) > args.size:
                image.thumbnail((args.size, args.size), Image.Resampling.LANCZOS)
            rgba, box = isolate(image, args.background_tolerance)
            prepared.append((rgba, box))
    if coverage:
        fractions = [(box[3]-box[1])/image.height for image, box in prepared]
        if max(fractions)/min(fractions) > 1.5:
            raise ValueError('Subject framing differs too much; regenerate consistent photographic views.')
        prepared = align_views(prepared, args.size)
    if coverage:
        reject_retraced_views(prepared, coverage)
    boxes = np.asarray([box for _, box in prepared])
    heights = boxes[:, 3] - boxes[:, 1]
    if len(paths) > 1 and np.ptp(heights) / np.median(heights) > 0.18:
        raise ValueError('Subject scale changes across views; regenerate a fixed-scale orbit.')
    width, height = prepared[0][0].size
    margin = max(8, round(height * .025))
    crop = (max(0, int(boxes[:, 0].min())-margin), max(0, int(boxes[:, 1].min())-margin), min(width, int(boxes[:, 2].max())+margin), min(height, int(boxes[:, 3].max())+margin))
    textures = []
    for index, (image, _) in enumerate(prepared):
        name = f'view-{index:03d}.png'
        image = clean_invisible_colors(image.crop(crop))
        image.save(out / name)
        textures.append({'file': name, 'sha256': hashlib.sha256((out/name).read_bytes()).hexdigest(), 'angle_degrees': angles[index], 'transparent_pixel_fraction': float((np.asarray(image)[:, :, 3] == 0).mean())})
    report = {
        'version': 2, 'coverage': coverage, 'mode': 'views' if args.frames else 'cutout',
        'width': crop[2]-crop[0], 'height': crop[3]-crop[1], 'textures': textures,
        'appearance': 'photographic image textures; no reconstructed facial geometry or vertex colors',
        'source_files': [str(path) for path in paths], 'crop': list(crop),
        'limitations': ['generated unseen views are inferred', 'view angles are inspected estimates, not calibrated camera measurements'] if args.frames else ['shallow curved photograph, not a complete human or object scan', 'best viewed within 35 degrees of the front'],
    }
    (out/'photo-object.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({'manifest': str(out/'photo-object.json'), 'mode': report['mode'], 'views': len(paths), 'texture_size': [report['width'], report['height']]}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--image', type=Path, help='Existing isolated image or transparent PNG')
    source.add_argument('--frames', type=Path, help='Ordered full-orbit frames from an existing Gemini video')
    parser.add_argument('--coverage', type=Path, help='JSON inspected view angles and front, both profiles, back evidence; required for frames')
    parser.add_argument('--out', type=Path, required=True, help='New texture preparation directory outside /workspace/output')
    parser.add_argument('--size', type=int, default=2048, help='Maximum texture dimension; use 2048 for a cutout and 1080 for orbit frames')
    parser.add_argument('--background-tolerance', type=float, default=32)
    args = parser.parse_args()
    if not 256 <= args.size <= 4096:
        parser.error('Texture size must be 256–4096')
    try:
        prepare(args)
    except (ValueError, OSError) as error:
        parser.exit(1, f'Photo object preparation failed: {error}\n')


if __name__ == '__main__':
    main()
