"""Run with the geometry interpreter installed by agents/bin/object3d-setup."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image
import trimesh

SCRIPT = Path(__file__).resolve().parents[1] / "skills/photo-to-3d/reconstruct.py"
spec = importlib.util.spec_from_file_location("reconstruct", SCRIPT)
reconstruction = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reconstruction)


class ReconstructionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.frames = self.root / "frames"
        self.frames.mkdir()
        self.out = self.root / "mesh"
        y, x = np.mgrid[:256, :256]
        for i, angle in enumerate(np.arange(24) * 2 * np.pi / 24):
            radius = np.sqrt((0.55 * np.cos(angle)) ** 2 + (0.9 * np.sin(angle)) ** 2)
            mask = ((x - 128) / (radius * 100)) ** 2 + ((y - 128) / 80) ** 2 <= 1
            image = np.full((256, 256, 3), 240, dtype=np.uint8)
            image[mask] = [210, 65, 50]
            Image.fromarray(image).save(self.frames / f"frame-{i:03d}.png")

    def tearDown(self):
        self.tmp.cleanup()

    def run_reconstruction(self, *extra):
        return subprocess.run([sys.executable, str(SCRIPT), "--frames", str(self.frames),
                               "--out", str(self.out), "--grid", "64", *extra],
                              text=True, capture_output=True, timeout=60)

    def test_closed_surface_recovers_known_dimensions_colors_and_gltf_axes(self):
        result = self.run_reconstruction()
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads((self.out / "reconstruction.json").read_text())
        self.assertGreater(report["mean_silhouette_iou"], 0.95)
        self.assertTrue(report["watertight"])
        mesh = trimesh.load(self.out / "object.ply", force="mesh")
        self.assertTrue(mesh.is_watertight)
        np.testing.assert_allclose(mesh.extents, [1.1, 1.8, 1.6], atol=0.08)
        gltf = trimesh.load(self.out / "object.glb", force="mesh")
        np.testing.assert_allclose(gltf.extents, [1.1, 1.6, 1.8], atol=0.08)
        self.assertGreater((gltf.visual.vertex_colors[:, 0] > gltf.visual.vertex_colors[:, 1] + 50).mean(), 0.9)

    def test_partial_orbit_is_rejected_without_exporting_a_mesh(self):
        angles = self.root / "angles.json"
        angles.write_text(json.dumps(np.linspace(0, 180, 24).tolist()))
        result = self.run_reconstruction("--angles", str(angles))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.out / "object.glb").exists())
        self.assertIn("coverage", result.stderr)

    def test_zooming_orbit_is_rejected(self):
        image = Image.open(self.frames / "frame-000.png")
        smaller = image.resize((180, 180))
        image = Image.new("RGB", (256, 256), (240, 240, 240))
        image.paste(smaller, (38, 38))
        image.save(self.frames / "frame-000.png")
        result = self.run_reconstruction()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("framing", result.stderr)
        self.assertFalse((self.out / "object.glb").exists())

    def test_border_flood_preserves_light_foreground_and_alpha(self):
        image = np.full((100, 100, 3), 255, dtype=np.uint8)
        image[20:80, 20:80] = [230, 230, 230]
        mask = reconstruction.foreground(Image.fromarray(image), 35)
        self.assertTrue(mask[50, 50])
        self.assertFalse(mask[5, 5])
        rgba = np.full((100, 100, 4), 255, dtype=np.uint8)
        rgba[:20, :, 3] = 0
        mask = reconstruction.foreground(Image.fromarray(rgba), 35)
        self.assertFalse(mask[5, 5])
        self.assertTrue(mask[50, 50])


if __name__ == "__main__":
    unittest.main()
