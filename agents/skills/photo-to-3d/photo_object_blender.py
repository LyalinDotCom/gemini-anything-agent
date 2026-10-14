"""Pack photographic cutouts or Gemini angle views into a Blender scene and GLB."""
import argparse
import json
import math
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def photo_material(path):
    material = bpy.data.materials.new(path.stem)
    material.use_nodes = True
    nodes = material.node_tree.nodes; nodes.clear()
    image = bpy.data.images.load(str(path.resolve()), check_existing=True)
    image.pack()
    texture = nodes.new('ShaderNodeTexImage'); texture.image = image
    emission = nodes.new('ShaderNodeEmission'); emission.inputs['Strength'].default_value = 1
    transparent = nodes.new('ShaderNodeBsdfTransparent')
    mix = nodes.new('ShaderNodeMixShader')
    output = nodes.new('ShaderNodeOutputMaterial')
    links = material.node_tree.links
    links.new(texture.outputs['Color'], emission.inputs['Color'])
    links.new(texture.outputs['Alpha'], mix.inputs[0])
    links.new(transparent.outputs[0], mix.inputs[1]); links.new(emission.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], output.inputs['Surface'])
    if hasattr(material, 'surface_render_method'): material.surface_render_method = 'DITHERED'
    if hasattr(material, 'blend_method'): material.blend_method = 'HASHED'
    material.use_backface_culling = False
    return material


def curved_surface(name, width, depth, material):
    nx, nz = 48, 72
    vertices = []
    for j in range(nz+1):
        v = j/nz
        for i in range(nx+1):
            u = i/nx
            bulge = (1-4*(u-.5)**2) * (1-.5*4*(v-.5)**2)
            vertices.append(((u-.5)*width, -depth*bulge, (v-.5)*2))
    faces = []
    for j in range(nz):
        for i in range(nx):
            a=j*(nx+1)+i
            faces.append((a,a+1,a+nx+2,a+nx+1))
    mesh = bpy.data.meshes.new(name); mesh.from_pydata(vertices, [], faces); mesh.update()
    uv = mesh.uv_layers.new(name='Photo UV')
    for polygon in mesh.polygons:
        polygon.use_smooth = True
        for loop in polygon.loop_indices:
            index = mesh.loops[loop].vertex_index
            uv.data[loop].uv = ((index % (nx+1))/nx, (index//(nx+1))/nz)
    obj = bpy.data.objects.new(name, mesh); bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def set_unlit(glb_path):
    # glTF readers must display the original photographic colors without relighting.
    raw = glb_path.read_bytes()
    length, kind = struct.unpack_from('<II', raw, 12)
    document = json.loads(raw[20:20+length])
    for material in document.get('materials', []):
        pbr = material.setdefault('pbrMetallicRoughness', {})
        # Blender exports the emission graph as an emissive texture. Unlit glTF
        # readers use baseColorTexture, including its PNG alpha, instead.
        if material.get('emissiveTexture'):
            pbr['baseColorTexture'] = material.pop('emissiveTexture')
            pbr['baseColorFactor'] = [1, 1, 1, 1]
            material['emissiveFactor'] = [0, 0, 0]
        material.setdefault('extensions', {})['KHR_materials_unlit'] = {}
        material['alphaMode'] = 'BLEND'; material['doubleSided'] = True
    used = document.setdefault('extensionsUsed', [])
    if 'KHR_materials_unlit' not in used: used.append('KHR_materials_unlit')
    encoded = json.dumps(document, separators=(',', ':')).encode()
    encoded += b' ' * ((-len(encoded)) % 4)
    remainder = raw[20+length:]
    updated = struct.pack('<III', 0x46546C67, 2, 20+len(encoded)+len(remainder)) + struct.pack('<II', len(encoded), kind) + encoded + remainder
    glb_path.write_bytes(updated)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--resolution', type=int, default=768)
    parser.add_argument('--preview-frames', type=int, default=24)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    manifest = json.loads(args.manifest.read_text())
    out = args.out.resolve(); out.mkdir(parents=True, exist_ok=True)
    if any((out/name).exists() for name in ('object.blend', 'object.glb')):
        raise RuntimeError('Use a new output directory')
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    width = manifest['width']/manifest['height']*2
    objects=[]
    for index, texture in enumerate(manifest['textures']):
        material = photo_material(args.manifest.parent / texture['file'])
        obj = curved_surface(f'Photo view {index:03d}', width, .065 if manifest['mode']=='cutout' else .025, material)
        obj['photo_object_mode'] = manifest['mode']; obj['photo_view_index'] = index
        obj['photo_view_count'] = len(manifest['textures'])
        obj['photo_view_angle_degrees'] = texture['angle_degrees']
        obj['photo_view_azimuth_sign'] = (manifest.get('coverage') or {}).get('azimuth_sign', 1)
        objects.append(obj)
    scene = bpy.context.scene
    scene.render.engine='CYCLES'; scene.cycles.device='CPU'; scene.cycles.samples=16
    # Distribution Blender builds can lack OpenImageDenoiser. Unlit photographs
    # need no denoiser, and the saved scene must reopen on the same CPU build.
    scene.cycles.use_denoising=False
    for layer in scene.view_layers:
        if hasattr(layer, 'cycles'): layer.cycles.use_denoising=False
    scene.render.resolution_x=args.resolution; scene.render.resolution_y=args.resolution; scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'; scene.render.fps=12
    scene.view_settings.view_transform='Standard'
    scene.world.use_nodes=True; scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.82,.85,.82,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=1
    camera_data=bpy.data.cameras.new('Photo object camera')
    camera=bpy.data.objects.new('Photo object camera',camera_data); scene.collection.objects.link(camera)
    camera_data.type='ORTHO'; camera_data.ortho_scale=max(2,width)*1.25
    scene.camera=camera
    frames = len(objects) if manifest['mode']=='views' else args.preview_frames
    for frame in range(frames):
        angle = 0 if manifest['mode']=='views' else math.sin(2*math.pi*frame/frames)*math.radians(25)
        camera.location=(math.sin(angle)*4,-math.cos(angle)*4,.03)
        camera.rotation_euler=(-camera.location).to_track_quat('-Z','Y').to_euler()
        camera.keyframe_insert(data_path='location',frame=frame+1); camera.keyframe_insert(data_path='rotation_euler',frame=frame+1)
        for index,obj in enumerate(objects):
            obj.scale=(1,1,1) if index==frame%len(objects) else (0,0,0)
            obj.keyframe_insert(data_path='scale',frame=frame+1)
    scene.frame_start=1; scene.frame_end=frames; scene.frame_set(1)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects: obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.export_scene.gltf(filepath=str(out/'object.glb'), export_format='GLB', use_selection=True, export_extras=True, export_animations=False)
    set_unlit(out/'object.glb')
    bpy.ops.file.pack_all(); bpy.ops.wm.save_as_mainfile(filepath=str(out/'object.blend'))
    scene.render.filepath=str(out/'preview.png'); bpy.ops.render.render(write_still=True)
    (out/'frames').mkdir(); scene.render.filepath=str(out/'frames'/'frame-'); bpy.ops.render.render(animation=True)
    report={**manifest, 'blender_version':bpy.app.version_string, 'packed_textures':len(objects), 'photo_object_mode':manifest['mode'], 'max_front_angle_degrees':35 if manifest['mode']=='cutout' else 360, 'preview_frames':frames, 'status':'completed'}
    (out/'photo-object.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'glb':str(out/'object.glb'),'blend':str(out/'object.blend'),'mode':manifest['mode'],'views':len(objects)}))


if __name__=='__main__': main()
