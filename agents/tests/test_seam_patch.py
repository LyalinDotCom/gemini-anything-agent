import json, subprocess, sys, tempfile, unittest, importlib.util
from unittest.mock import patch
from pathlib import Path
import numpy as np
from PIL import Image
SCRIPT=Path(__file__).resolve().parents[1]/'skills/gigapixel-gemini-mosaic/scripts/seam_patch.py'
class SeamPatchTests(unittest.TestCase):
 def test_native_patch_preserves_context_and_global_edge_and_is_repeatable(self):
  with tempfile.TemporaryDirectory() as d:
   run=Path(d);Image.new('RGB',(1024,1024),'white').save(run/'mosaic.png')
   spec=run/'spec.json';spec.write_text(json.dumps([{'name':'join','box':[0,0,768,768]}]))
   command=[sys.executable,str(SCRIPT),'--run',str(run),'--spec',str(spec)]
   subprocess.run(command+['prepare'],check=True,capture_output=True)
   Image.new('RGB',(768,768),'black').save(run/'seam-repairs/join-edited.jpg')
   (run/'seam-repairs/join-response.json').write_text('{"ok":true}')
   for _ in range(2):
    subprocess.run(command+['apply'],check=True,capture_output=True)
    pixels=np.asarray(Image.open(run/'mosaic.png'))
    self.assertTrue((pixels[0,0]==0).all());self.assertTrue((pixels[500,500]==0).all())
    self.assertTrue((pixels[650,500]==255).all());self.assertTrue((pixels[800,800]==255).all())
   self.assertEqual(json.loads((run/'seam-repair-validation.json').read_text())['size'],[1024,1024])
   saved=(run/'mosaic.png').read_bytes();spec.write_text(json.dumps([{'name':'other','box':[0,0,768,768]}]))
   result=subprocess.run(command+['prepare'],capture_output=True)
   self.assertNotEqual(result.returncode,0);self.assertEqual(saved,(run/'mosaic.png').read_bytes())
 def test_undersized_edit_cannot_overwrite_original(self):
  with tempfile.TemporaryDirectory() as d:
   run=Path(d);Image.new('RGB',(768,768),'white').save(run/'mosaic.png');before=(run/'mosaic.png').read_bytes()
   spec=run/'spec.json';spec.write_text(json.dumps([{'name':'join','box':[0,0,768,768]}]))
   command=[sys.executable,str(SCRIPT),'--run',str(run),'--spec',str(spec)]
   subprocess.run(command+['prepare'],check=True,capture_output=True)
   Image.new('RGB',(64,64),'black').save(run/'seam-repairs/join-edited.jpg')
   (run/'seam-repairs/join-response.json').write_text('{"ok":true}')
   result=subprocess.run(command+['apply'],capture_output=True)
   self.assertNotEqual(result.returncode,0);self.assertEqual(before,(run/'mosaic.png').read_bytes())
 def test_rebuilt_mosaic_cannot_be_overwritten_by_stale_repair(self):
  with tempfile.TemporaryDirectory() as d:
   run=Path(d);Image.new('RGB',(768,768),'white').save(run/'mosaic.png')
   spec=run/'spec.json';spec.write_text(json.dumps([{'name':'join','box':[0,0,768,768]}]))
   command=[sys.executable,str(SCRIPT),'--run',str(run),'--spec',str(spec)]
   subprocess.run(command+['prepare'],check=True,capture_output=True)
   Image.new('RGB',(768,768),'blue').save(run/'fresh.png');(run/'fresh.png').replace(run/'mosaic.png');saved=(run/'mosaic.png').read_bytes()
   result=subprocess.run(command+['prepare'],capture_output=True)
   self.assertNotEqual(result.returncode,0);self.assertEqual(saved,(run/'mosaic.png').read_bytes())
 def test_invalid_first_spec_can_be_corrected(self):
  with tempfile.TemporaryDirectory() as d:
   run=Path(d);Image.new('RGB',(1024,1024),'white').save(run/'mosaic.png')
   spec=run/'spec.json';spec.write_text(json.dumps([{'name':'join','box':[0,0,64,64]}]))
   command=[sys.executable,str(SCRIPT),'--run',str(run),'--spec',str(spec)]
   self.assertNotEqual(subprocess.run(command+['prepare'],capture_output=True).returncode,0)
   spec.write_text(json.dumps([{'name':'join','box':[0,0,768,768]}]))
   subprocess.run(command+['prepare'],check=True,capture_output=True)
 def test_interrupted_image_swap_can_resume(self):
  with tempfile.TemporaryDirectory() as d:
   run=Path(d);Image.new('RGB',(768,768),'white').save(run/'mosaic.png')
   spec=run/'spec.json';spec.write_text(json.dumps([{'name':'join','box':[0,0,768,768]}]))
   command=[sys.executable,str(SCRIPT),'--run',str(run),'--spec',str(spec)]
   subprocess.run(command+['prepare'],check=True,capture_output=True)
   Image.new('RGB',(768,768),'black').save(run/'seam-repairs/join-edited.jpg');(run/'seam-repairs/join-response.json').write_text('{"ok":true}')
   definition=importlib.util.spec_from_file_location('seam_patch',SCRIPT);module=importlib.util.module_from_spec(definition);definition.loader.exec_module(module)
   actual=module.os.replace
   def interrupt(source,destination):
    if str(destination).endswith('mosaic.png'):raise KeyboardInterrupt()
    actual(source,destination)
   with patch.object(sys,'argv',[str(SCRIPT),'apply','--run',str(run),'--spec',str(spec)]),patch.object(module.os,'replace',side_effect=interrupt):
    with self.assertRaises(KeyboardInterrupt):module.main()
   subprocess.run(command+['apply'],check=True,capture_output=True)
   self.assertEqual(Image.open(run/'mosaic.png').getpixel((0,0)),(0,0,0))
if __name__=='__main__':unittest.main()
