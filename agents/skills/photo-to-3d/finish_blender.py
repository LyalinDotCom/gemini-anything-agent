"""Import a reconstructed GLB into Blender, save a scene, render a turntable."""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mesh", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True, help="New Blender output directory")
    parser.add_argument("--frames", type=int, default=72)
    parser.add_argument("--resolution", type=int, default=768)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    if args.frames < 12 or not 128 <= args.resolution <= 2048:
        parser.error("Use at least 12 frames and a resolution between 128 and 2048")
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    if any((out / name).exists() for name in ("object.blend", "object.glb", "preview.png", "frames")):
        parser.error("Output already contains deliverables; use a new directory")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(args.mesh.resolve()))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and len(obj.data.polygons)]
    if not meshes:
        raise RuntimeError("GLB contains no surface geometry")
    points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    low = Vector(tuple(min(point[i] for point in points) for i in range(3)))
    high = Vector(tuple(max(point[i] for point in points) for i in range(3)))
    center = (low + high) / 2
    size = max(high - low)
    if size <= 0:
        raise RuntimeError("Mesh bounds are empty")
    # Preserve object transforms and scale; studio rig uses the measured bounds.
    for obj in meshes:
        obj.name = "Reconstructed Object" if len(meshes) == 1 else obj.name
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        # glTF import usually creates a vertex-color material. Ensure a color
        # node also exists if the importer omitted it (works in Blender 3/4/5).
        attributes = getattr(obj.data, "color_attributes", None)
        color_name = attributes[0].name if attributes and len(attributes) else None
        if color_name:
            material = bpy.data.materials.new("Photo projected vertex colors")
            material.use_nodes = True
            nodes = material.node_tree.nodes
            bsdf = nodes.get("Principled BSDF")
            color = nodes.new("ShaderNodeVertexColor")
            color.layer_name = color_name
            material.node_tree.links.new(color.outputs["Color"], bsdf.inputs["Base Color"])
            bsdf.inputs["Roughness"].default_value = 0.65
            obj.data.materials.clear()
            obj.data.materials.append(material)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = args.resolution
    scene.render.resolution_y = args.resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.fps = 24
    scene.world.color = (0.18, 0.18, 0.18)
    for name, offset, power in [("Key", (2, -3, 4), 250), ("Fill", (-3, -1, 1), 100), ("Rim", (1, 3, 3), 200)]:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = power * size * size
        data.shape = "DISK"
        data.size = size * 2
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = center + Vector(offset) * size
        aim(obj, center)
    data = bpy.data.cameras.new("Turntable Camera")
    camera = bpy.data.objects.new("Turntable Camera", data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    data.type = "ORTHO"
    data.ortho_scale = size * 1.55
    data.clip_end = max(1000, size * 20)
    for frame in range(args.frames):
        angle = 2 * math.pi * frame / args.frames
        camera.location = center + Vector((math.sin(angle) * 3, -math.cos(angle) * 3, 1.2)) * size
        aim(camera, center)
        camera.keyframe_insert(data_path="location", frame=frame + 1)
        camera.keyframe_insert(data_path="rotation_euler", frame=frame + 1)
    scene.frame_start, scene.frame_end = 1, args.frames
    scene.frame_set(1)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.export_scene.gltf(filepath=str(out / "object.glb"), export_format="GLB", use_selection=True)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(out / "object.blend"))
    scene.render.filepath = str(out / "preview.png")
    bpy.ops.render.render(write_still=True)
    (out / "frames").mkdir()
    scene.render.filepath = str(out / "frames" / "frame-")
    bpy.ops.render.render(animation=True)
    (out / "blender-validation.json").write_text(json.dumps({
        "blender_version": bpy.app.version_string, "mesh_objects": len(meshes),
        "vertices": sum(len(obj.data.vertices) for obj in meshes),
        "faces": sum(len(obj.data.polygons) for obj in meshes), "turntable_frames": args.frames,
        "render_engine": "CYCLES", "device": "CPU"
    }, indent=2) + "\n")


if __name__ == "__main__":
    main()
