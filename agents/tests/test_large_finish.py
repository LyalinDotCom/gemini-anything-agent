import hashlib,json,subprocess,sys,tempfile,unittest
from pathlib import Path
from PIL import Image
SCRIPT=Path(__file__).resolve().parents[1]/'skills/gigapixel-gemini-mosaic/scripts/finish.py'
class LargeFinishTests(unittest.TestCase):
 def test_finalizer_records_actual_bytes_and_rejects_unmatched_repair(self):
  with tempfile.TemporaryDirectory() as d:
   run=Path(d)/'run';run.mkdir();(run/'qa').mkdir();(run/'responses').mkdir();(run/'tiles').mkdir()
   Image.new('RGB',(64,64),'orange').save(run/'mosaic.png');Image.new('RGB',(64,64),'orange').save(run/'mosaic.jpg');Image.new('RGB',(32,32),'orange').save(run/'preview_overview.jpg');(run/'deepzoom.zip').write_bytes(b'fixture')
   tile=run/'tiles/tile_r0_c0.png';tile.write_bytes((run/'mosaic.png').read_bytes())
   (run/'composition-validation.json').write_text(json.dumps({'generated_tiles':1,'mosaic_sha256':hashlib.sha256((run/'mosaic.png').read_bytes()).hexdigest(),'native_inputs':[{'rc':[0,0],'sha256':hashlib.sha256(tile.read_bytes()).hexdigest()}]}));(run/'qa/summary.json').write_text('{"pass":true}')
   (run/'responses/resp_r0_c0.json').write_text('{"path":"/workspace/fixture.png","response_id":"fixture-response","model":"fixture"}');(run/'world_plan.json').write_text('{}')
   output=Path(d)/'output';command=[sys.executable,str(SCRIPT),'--run',str(run),'--output',str(output),'--skills','gigapixel-gemini-mosaic']
   subprocess.run(command,check=True,capture_output=True)
   v=json.loads((output/'validation.json').read_text());self.assertEqual(v['size'],[64,64]);self.assertEqual(v['final_artifacts']['mosaic.png']['sha256'],hashlib.sha256((output/'mosaic.png').read_bytes()).hexdigest());self.assertFalse(v['finalized_in_managed_agent'])
   old=(output/'validation.json').read_bytes();(run/'seam-repair-validation.json').write_text('{"final_sha256":"wrong"}')
   self.assertNotEqual(subprocess.run(command,capture_output=True).returncode,0);self.assertEqual(old,(output/'validation.json').read_bytes())
if __name__=='__main__':unittest.main()
