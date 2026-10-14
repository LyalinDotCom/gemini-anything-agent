"""Native isolation must preserve photographic pixels and reject broken framing."""
import importlib.util
from pathlib import Path
import unittest
import tempfile
import json

import numpy as np
from PIL import Image

script = Path(__file__).resolve().parents[1] / "skills/photo-to-3d/prepare_photo_object.py"
spec = importlib.util.spec_from_file_location("photo_objects", script)
photo_objects = importlib.util.module_from_spec(spec)
spec.loader.exec_module(photo_objects)


class PhotoObjectTests(unittest.TestCase):
    def test_opaque_photographic_colors_survive_background_removal(self):
        image = np.full((128, 128, 3), [190, 190, 190], dtype=np.uint8)
        rng = np.random.default_rng(42)
        image[20:108, 40:88] = rng.integers([10, 40, 50], [60, 110, 150], (88, 48, 3), dtype=np.uint8)
        result, _ = photo_objects.isolate(Image.fromarray(image))
        rgba = np.asarray(result)
        np.testing.assert_array_equal(rgba[24:104, 44:84, :3], image[24:104, 44:84])
        self.assertTrue((rgba[24:104, 44:84, 3] == 255).all())
        self.assertEqual(rgba[0, 0, 3], 0)
        self.assertTrue(((rgba[:, :, 3] > 0) & (rgba[:, :, 3] < 255)).any())

    def test_existing_alpha_and_photo_colors_are_preserved(self):
        image = np.zeros((128, 128, 4), dtype=np.uint8)
        image[20:108, 40:88] = [42, 113, 132, 255]
        image[20, 40:88, 3] = 80
        result, _ = photo_objects.isolate(Image.fromarray(image))
        np.testing.assert_array_equal(np.asarray(result), image)

    def test_clipped_subject_is_rejected(self):
        image = np.zeros((128, 128, 4), dtype=np.uint8)
        image[:100, 40:88] = [42, 113, 132, 255]
        with self.assertRaisesRegex(ValueError, "clipped"):
            photo_objects.isolate(Image.fromarray(image))

    def test_empty_background_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "No foreground"):
            photo_objects.isolate(Image.new("RGB", (128, 128), "white"))

    def test_coverage_requires_both_profiles_and_monotonic_angles(self):
        paths = [Path(f'frame-{i:03d}.png') for i in range(32)]
        coverage = {'views': [{'file': p.name, 'angle_degrees': i*360/32} for i,p in enumerate(paths)],
                    'evidence': {label: paths[i].name for label,i in [('front',0),('first_profile',8),('back',16),('opposite_profile',24)]}}
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)/'coverage.json'
            path.write_text(json.dumps(coverage))
            _, angles = photo_objects.validate_coverage(path, paths)
            self.assertEqual(angles[24], 270)
            coverage['views'][24]['angle_degrees'] = 90
            path.write_text(json.dumps(coverage))
            with self.assertRaisesRegex(ValueError, 'no reversal'):
                photo_objects.validate_coverage(path, paths)
            coverage['views'][24]['angle_degrees'] = 270
            coverage['evidence']['opposite_profile'] = paths[8].name
            path.write_text(json.dumps(coverage))
            with self.assertRaisesRegex(ValueError, 'opposite_profile'):
                photo_objects.validate_coverage(path, paths)
        with self.assertRaisesRegex(ValueError, '--coverage'):
            photo_objects.validate_coverage(None, paths)

    def test_invisible_color_cleanup_preserves_every_visible_pixel_and_alpha(self):
        image = np.full((32,32,4), [255,0,255,0], dtype=np.uint8)
        image[8:24,8:24] = [40,120,150,255]
        image[8,8:24] = [40,120,150,70]
        result = np.asarray(photo_objects.clean_invisible_colors(Image.fromarray(image)))
        np.testing.assert_array_equal(result[:,:,3], image[:,:,3])
        np.testing.assert_array_equal(result[image[:,:,3]>0], image[image[:,:,3]>0])
        self.assertTrue((result[0,0,:3] == 0).all())
        np.testing.assert_array_equal(result[7,12,:3], [40,120,150])

    def test_mixed_photo_resolutions_align_to_a_common_transparent_canvas(self):
        prepared = []
        for width,height in [(180,320),(360,640)]:
            image = Image.new('RGBA',(width,height))
            image.paste((40,120,150,255),(width//3,height//5,2*width//3,4*height//5))
            prepared.append((image, image.getchannel('A').getbbox()))
        aligned = photo_objects.align_views(prepared,1080)
        self.assertEqual(aligned[0][0].size, aligned[1][0].size)
        self.assertEqual(aligned[0][1][3]-aligned[0][1][1], aligned[1][1][3]-aligned[1][1][1])
        self.assertLessEqual(max(aligned[0][0].size),1080)
        self.assertEqual(np.asarray(aligned[0][0])[0,0,3],0)

    def test_retraced_asymmetric_images_are_rejected(self):
        def image(angle):
            pixels = np.zeros((128,64,4),dtype=np.uint8)
            pixels[16:112,16:48] = [round(120+80*np.cos(angle)),round(120+80*np.sin(angle)),80,255]
            return (Image.fromarray(pixels), (16,16,48,112))
        true_circle = [image(i*2*np.pi/32) for i in range(32)]
        photo_objects.reject_retraced_views(true_circle, {'asymmetric_subject':True})
        retraced = true_circle[:17]+list(reversed(true_circle[1:16]))
        with self.assertRaisesRegex(ValueError, 'out-and-back'):
            photo_objects.reject_retraced_views(retraced, {'asymmetric_subject':True})

    def test_actual_old_production_orbit_is_rejected(self):
        import struct, io
        source = Path(__file__).resolve().parents[2]/'web/public/examples/person-cat-views-v2.glb'
        if not source.exists():
            self.skipTest('Historical broken orbit fixture is unavailable')
        data = source.read_bytes()
        length = struct.unpack_from('<I',data,12)[0]
        gltf = json.loads(data[20:20+length])
        body = data[28+length:]
        images = []
        for image in gltf['images']:
            view = gltf['bufferViews'][image['bufferView']]
            offset = view.get('byteOffset',0)
            photo = Image.open(io.BytesIO(body[offset:offset+view['byteLength']])).convert('RGBA')
            images.append((photo,photo.getchannel('A').getbbox()))
        images = photo_objects.align_views(images,1080)
        with self.assertRaisesRegex(ValueError,'out-and-back'):
            photo_objects.reject_retraced_views(images,{'asymmetric_subject':True})


if __name__ == "__main__":
    unittest.main()
