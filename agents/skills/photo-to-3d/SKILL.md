---
name: photo-to-3d
description: Create a full-circle photographic 3D View from Gemini-generated views inside the managed Linux agent, preserving identity and transparency and packaging in Blender and GLB.
---

# 3D View

All visual generation uses the published official Gemini API CLI inside this managed Linux agent. Native helpers transform existing artifacts only. No third-party hosted 3D services or alternative generators. Preserve actual photographic textures, faces, hands, fur and contact; never substitute the rejected organic silhouette mesh.

## Source

Discover `bash /.agents/bin/gemini-api --help`, then subcommand help and schema. Save the schema once under /tmp and inspect its $defs/oneOf structure in one batched native command, selecting definitions whose names mention Video or ResponseFormat. Do not repeatedly print the entire schema or guess nonexistent top-level fields. Preserve operation IDs and resume generations rather than resubmitting. Inspect the supplied photo. Use its verified private Files API reference as actual CLI image input; retain hash and byte count. Use the supplied private Files reference for generation; if working from a local path, verify its bytes/hash before use. If its reference is invalid, stop promptly with the specific error.

Create an isolated photographic reference with a uniform contrasting background. Person and cat are one rigid foreground subject, with the original identity, pose, hands and contact. Preserve the entire subject and use portrait framing with generous margins at head and shoes. The backdrop must be flat and unlit, with no studio floor, ground shadow or background gradient. A pure contrasting chroma background is easier to isolate. Inspect the isolation.

## Complete the circle

A video saying “360” is not evidence of 360 coverage. The previous sample went front → one side → back → SAME side → front, which made the viewer reverse. Reject this result.

Generate a single monotonic full turn with fixed framing, scale, lighting and camera height. Describe explicit milestones: front at 0%, first profile facing LEFT on screen at 25%, back at 50%, OPPOSITE profile facing RIGHT on screen at 75%, front at 100%. The second half must reveal the other side, never rewind, reverse, mirror, oscillate, or dissolve. A fixed camera and rigid subject turning on a turntable can reduce camera ambiguity. Use the invocation's video model at its highest supported resolution.

Inspect a contact sheet of the WHOLE video, including both profiles, and compare asymmetric cues such as cat head/tail, hands, shirt folds and hair. A face/profile on the same screen side in both halves is a reversal. If one retry still retraces, generate a coherent complete set of explicit-angle photographic images with Gemini (using the same reference and consistent reference anchors) for the missing sides. Never mirror an existing view. Inspect each image for correct orientation, identity, pose and contact.

Select at least 16, preferably 32 views by observed angle, NOT evenly spaced time. A nonuniform-speed video needs nonuniform frame sampling. A complete set starts at front=0°, traverses one direction, includes distinct opposite profiles near 90° and 270°, reaches back near 180°, and closes without a duplicated 360° image. Keep angular gaps at most 30°. Do not invent or label unobserved angles. If coverage cannot be completed, state the failure and preserve partial source artifacts without claiming a full 3D View.

Write `view-coverage.json` outside final output:
```
{"asymmetric_subject":true,"azimuth_sign":1,"views":[{"file":"frame-000.png","angle_degrees":0}, ...],
 "evidence":{"front":"frame-000.png","first_profile":"...","back":"...","opposite_profile":"..."},
 "inspection":"Explain observed opposite-side asymmetric features and identity checks; angles are estimated."}
```
The standard is camera azimuth: 0° front, 90° profile facing LEFT on screen, 180° back, 270° profile facing RIGHT. Set azimuth_sign=1 for that order. If a rigid turntable/image set instead has the 90° profile facing RIGHT and 270° facing LEFT, set azimuth_sign=-1 so the web camera still selects the correct physical side. Set asymmetric_subject=true for a person/cat or another visibly asymmetric subject; false only for genuinely symmetric products. The native helper rejects likely retraced asymmetric views using image differences. Entries must match sorted frame filenames. Preserve this evidence in final metadata. The native helper checks coverage bounds/order; visual inspection is still required and must not be replaced by fabricated metadata.

## Native packaging and delivery

Run `bash /.agents/bin/object3d-setup` for Blender, ffmpeg and CPU dependencies. Use the printed interpreter. Discover `python /.agents/skills/photo-to-3d/prepare_photo_object.py --help` and supply `--frames`, `--coverage`, `--out` in a fresh durable working directory under /workspace/.photo-3d-work/<run>. It removes border-connected background, preserves photo textures, softens alpha edges, aligns foreground height and baseline on a common alpha canvas, and rejects clipped or severely inconsistent framing. Practical video textures can be 1080 px; inspect them on light and dark backgrounds.

Discover `blender --background --python /.agents/skills/photo-to-3d/photo_object_blender.py -- --help`. Package into `/workspace/output/photo-objects/<run>/views`. The helper packs unlit photographic textures into self-contained GLB, saves a packed Blender scene and renders previews/motion frames. Ordinary GLB viewers show the front; this web viewer selects photographic views by angle. Encode motion frames to MP4, remove only this run's intermediate render frames, and reopen the .blend in a fresh Blender process for verification.png. Verify actual PNG alpha, embedded textures, unlit material, coverage metadata and photographic appearance.

Keep native dependencies and logs under `/tmp`. Preserve expensive generated source images/video, coverage manifests and prepared photo textures under `/workspace/.photo-3d-work/<run>`, outside final output, so a container restart can resume them. Keep only canonical deliverables in the final output folder; do not duplicate the same packed assets into multiple output folders. Capture verbose setup and Blender logs under `/tmp`; return brief summaries, inspecting logs only on errors. Batch native operations to reduce agent round trips. Send concise progress updates at isolation, orbit, coverage and packaging stages; do not spend many calls discovering the same schema.

Deliver object.glb, object.blend, preview.png, verification.png, motion.mp4 and photo-object.json, plus the source orbit if used. After successful packaging and one fresh-process reopen check, save validation and finish. Do not search unrelated prior runs for metadata, rerender successful outputs repeatedly, or regenerate for minor unclipped framing differences.

State that unseen views are Gemini-inferred photographs on shallow surfaces, not a measured anatomical scan. Rounded photo is retired. Legacy reconstruct.py/finish_blender.py remain for explicitly requested historical experiments only.
