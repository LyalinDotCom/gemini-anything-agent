import importlib.util, json, tempfile, unittest, subprocess, sys, zipfile
from unittest.mock import patch
from pathlib import Path
from types import SimpleNamespace
import numpy as np
from PIL import Image
script=Path(__file__).resolve().parents[1]/'skills/gigapixel-gemini-mosaic/scripts/mosaic.py'
spec=importlib.util.spec_from_file_location('mosaic',script);mosaic=importlib.util.module_from_spec(spec);spec.loader.exec_module(mosaic)
class LargeImageTests(unittest.TestCase):
 def test_master_and_regions_share_the_exact_render_contract_and_explicit_model(self):
  with tempfile.TemporaryDirectory() as root:
   root=Path(root);Image.new('RGB',(256,144),'orange').save(root/'master.png')
   contract={'camera':'constant elevated view','subject_scale':'120-210px','regional_detail':'10-18 buildings','composition':'one continuous daylight scene'}
   plan={'style':'ink','macro_map_prompt':'whole world','render_contract':contract,'districts':{'0,0':{'title':'West','scene':'one continuous town'}}}
   (root/'plan.json').write_text(json.dumps(plan))
   args=SimpleNamespace(grid='2x2',canvas='2200x1200',tier='1K',tile='0,0',run=str(root),plan=str(root/'plan.json'),master=str(root/'master.png'),inset=(0,0))
   mosaic.cmd_master_request(args);mosaic.cmd_reference(args)
   master=json.loads((root/'master-request.json').read_text());region=json.loads((root/'tiles/request_r0_c0.json').read_text())
   self.assertEqual(master['model'],'gemini-nano-banana-2.1');self.assertEqual(region['model'],master['model'])
   self.assertEqual(region['render_contract'],contract)
   for key,value in contract.items():
    self.assertIn(value,region['prompt'])
    if key not in ('subject_scale','regional_detail'):self.assertIn(value,master['prompt'])
    else:self.assertNotIn(value,master['prompt'])
   self.assertNotIn(contract['subject_scale'],master['prompt']);self.assertGreater(master['master_to_canvas_scale'],0)
   self.assertIn('never independently zoom',region['prompt'])
 def test_master_crop_preserves_aspect_instead_of_stretching_generic_panorama(self):
  with tempfile.TemporaryDirectory() as root:
   path=Path(root)/'master.png';Image.new('RGB',(1000,1000),'orange').save(path)
   master=mosaic.load_master(path,(0,0),(3000,1000))
   self.assertAlmostEqual(master.width/master.height,3,delta=.01)
  with self.assertRaises(ValueError):mosaic.image_model({'image_model':None})
 def test_macro_guide_removes_fine_master_outlines_before_regional_generation(self):
  with tempfile.TemporaryDirectory() as root, patch.object(mosaic,'REF_W',256):
   stripes=np.tile(((np.arange(256)//8)%2*255).astype(np.uint8)[None,:,None],(144,1,3))
   guide,bands=mosaic.composite_reference(Image.fromarray(stripes),{(0,0):(0,0,256,144)},(0,0),Path(root),256,144,256,144)
   self.assertEqual(bands,[]);self.assertLess(np.asarray(guide)[:,64:-64].std(),2)
 def test_default_exposure_matching_cannot_imprint_another_subject(self):
  tile=np.full((64,64,3),255,dtype=np.uint8);reference=tile.copy();reference[16:48,16:48]=0
  np.testing.assert_array_equal(mosaic.match_luminance_lowpass(tile,reference),tile)
 def test_low_confidence_seam_keeps_one_source_instead_of_translucent_duplicates(self):
  a=np.zeros((32,64,3),dtype=np.float32);b=np.full_like(a,255);mask=np.tile(np.linspace(0,1,64,dtype=np.float32),(32,1))
  result=mosaic.laplacian_blend(a,b,mask,mask,4,hard=True)
  self.assertEqual(set(np.unique(result)),{0.,255.})
 def test_registration_rejects_large_translation_even_with_high_correlation(self):
  tile=np.zeros((144,256,3),dtype=np.uint8);tile[:,50:80]=255
  warp=np.array([[1,0,20*900/256],[0,1,0]],dtype=np.float32)
  with patch.object(mosaic.cv2,'findTransformECC',return_value=(0.8,warp)),patch.object(mosaic,'ncc',return_value=0.8):
   aligned,info=mosaic.register(tile,tile,256,144)
  np.testing.assert_array_equal(aligned,tile);self.assertEqual(info['used'],'identity')
 def test_grid_covers_canvas_with_overlap_and_no_missing_pixels(self):
  boxes=mosaic.grid_boxes(7,7,2752,1536,13334,7500)
  coverage=np.zeros((7500,13334),dtype=bool)
  for x0,y0,x1,y1 in boxes.values():coverage[y0:y1,x0:x1]=True
  self.assertTrue(coverage.all());self.assertEqual(boxes[(6,6)][2:],(13334,7500))
  with self.assertRaises(ValueError):mosaic.validate_geometry(2,2,100,100,250,250)
 def test_missing_regions_cannot_be_replaced_with_upscaled_master(self):
  with tempfile.TemporaryDirectory()as root:
   root=Path(root);(root/'tiles').mkdir();Image.new('RGB',(64,36),'orange').save(root/'master.png')
   with self.assertRaisesRegex(ValueError,'Missing generated tiles'):
    mosaic.cmd_build(SimpleNamespace(grid='2x2',canvas='200x100',tier='1K',run=str(root),master=str(root/'master.png'),inset=(0,0)))
 def test_native_reference_requires_ready_neighbours(self):
  with tempfile.TemporaryDirectory()as root:
   root=Path(root);Image.new('RGB',(256,144),'orange').save(root/'master.png');(root/'plan.json').write_text(json.dumps({'style':'ink','districts':{'0,1':{'title':'East','scene':'connected region'}}}))
   with self.assertRaisesRegex(ValueError,'neighbours'):
    mosaic.cmd_reference(SimpleNamespace(grid='2x2',canvas='2200x1200',tier='1K',tile='0,1',run=str(root),plan=str(root/'plan.json'),master=str(root/'master.png'),inset=(0,0)))
 def test_reference_preserves_sharp_neighbour_band_to_its_edge(self):
  with tempfile.TemporaryDirectory()as root, patch.object(mosaic,'REF_W',256):
   root=Path(root);(root/'tiles').mkdir()
   pixels=np.tile((np.arange(144)%2*255).astype(np.uint8)[:,None,None],(1,256,3));Image.fromarray(pixels).save(root/'tiles/tile_r0_c0.png')
   boxes=mosaic.grid_boxes(2,1,256,144,384,144)
   reference,bands=mosaic.composite_reference(Image.new('RGB',(384,144),'gray'),boxes,(0,1),root,256,144,384,144)
   image=np.asarray(reference);self.assertEqual(bands,['left'])
   np.testing.assert_array_equal(image[:,127],pixels[:,255])
   self.assertGreater(image[:,127].std(),120)
 def test_undersized_generated_tile_is_rejected_instead_of_upscaled(self):
  with tempfile.TemporaryDirectory()as root:
   root=Path(root);(root/'tiles').mkdir();Image.new('RGB',(64,36),'orange').save(root/'master.png')
   Image.new('RGB',(64,36),'blue').save(root/'tiles/tile_r0_c0.png')
   with self.assertRaisesRegex(ValueError,'No upscaling'):
    mosaic.cmd_build(SimpleNamespace(grid='1x1',canvas='1376x768',tier='1K',run=str(root),master=str(root/'master.png'),inset=(0,0)))
 def test_narrow_overlap_is_rejected(self):
  with self.assertRaisesRegex(ValueError,'128 pixels'):
   mosaic.validate_geometry(2,2,1376,768,2700,1500)
 def test_seam_backtracking_follows_the_low_cost_diagonal(self):
  cost=np.full((40,80),10000,dtype=np.float32);expected=20+np.arange(40)//2
  cost[np.arange(40),expected]=0
  np.testing.assert_array_equal(mosaic.minimum_cost_seam(cost,5),expected)
 def test_native_packager_writes_browser_compatible_stored_zip(self):
  with tempfile.TemporaryDirectory()as root:
   root=Path(root);Image.new('RGB',(256,144),'orange').save(root/'mosaic.png')
   subprocess.run([sys.executable,str(script.with_name('make_deepzoom.py')),'--run',str(root),'--tile-size','128','--workers','2'],check=True,capture_output=True)
   with zipfile.ZipFile(root/'deepzoom.zip') as archive:
    self.assertIn('manifest.json',archive.namelist());self.assertIn('overview.jpg',archive.namelist());self.assertIn('styles.css',archive.namelist())
    self.assertTrue(all(i.compress_type==zipfile.ZIP_STORED and not (i.flag_bits&9) for i in archive.infolist()))
    manifest=json.loads(archive.read('manifest.json'));self.assertEqual((manifest['width'],manifest['height']),(256,144))
 def test_composition_resumes_real_regions_from_durable_checkpoints(self):
  with tempfile.TemporaryDirectory()as root, patch.dict(mosaic.TIER_SIZE, {'TEST':(256,144)}):
   root=Path(root);(root/'tiles').mkdir();Image.new('RGB',(64,36),'orange').save(root/'master.png')
   for r in range(2):
    for c in range(2):Image.new('RGB',(256,144),(60+r*30,120+c*20,90)).save(root/f'tiles/tile_r{r}_c{c}.png')
   args=SimpleNamespace(grid='2x2',canvas='384x160',tier='TEST',run=str(root),master=str(root/'master.png'),inset=(0,0),batch_tiles=1,reset=False)
   for expected in range(1,5):
    result=mosaic.cmd_build(args);self.assertEqual(result['completed_tiles'],expected);self.assertFalse((root/'mosaic.png').exists())
   mosaic.cmd_build(args)
   with Image.open(root/'mosaic.png') as image:self.assertEqual(image.size,(384,160))
   validation=json.loads((root/'composition-validation.json').read_text());self.assertEqual(validation['generated_tiles'],4);self.assertTrue(validation['disk_backed_canvas'])
   Image.new('RGB',(256,144),'red').save(root/'tiles/tile_r1_c1.png')
   with self.assertRaisesRegex(ValueError,'inputs or compositor changed'):mosaic.cmd_build(args)
 def test_repeated_and_interrupted_reset_cannot_revive_stale_outputs(self):
  with tempfile.TemporaryDirectory()as root, patch.dict(mosaic.TIER_SIZE, {'TEST':(256,144)}):
   root=Path(root);(root/'tiles').mkdir();Image.new('RGB',(64,36),'orange').save(root/'master.png')
   for r in range(2):
    for c in range(2):Image.new('RGB',(256,144),(60+r*30,120+c*20,90)).save(root/f'tiles/tile_r{r}_c{c}.png')
   args=SimpleNamespace(grid='2x2',canvas='384x160',tier='TEST',run=str(root),master=str(root/'master.png'),inset=(0,0),batch_tiles=1,reset=False)
   for _ in range(5):mosaic.cmd_build(args)
   Image.new('RGB',(256,144),'red').save(root/'tiles/tile_r1_c1.png');args.reset=True
   with patch.object(mosaic,'register',side_effect=KeyboardInterrupt):
    with self.assertRaises(KeyboardInterrupt):mosaic.cmd_build(args)
   self.assertFalse((root/'mosaic.png').exists());self.assertFalse((root/'composition-validation.json').exists())
   self.assertEqual(json.loads((root/'.composition/state.json').read_text())['report'],{})
   for expected in range(1,5):self.assertEqual(mosaic.cmd_build(args)['completed_tiles'],expected)
   self.assertEqual(mosaic.cmd_build(args)['status'],'completed')
   with Image.open(root/'mosaic.png') as image:self.assertGreater(np.asarray(image).max(),0)
 def test_interrupted_region_rolls_back_and_resumes_to_the_same_pixels(self):
  with tempfile.TemporaryDirectory()as root, patch.dict(mosaic.TIER_SIZE, {'TEST':(256,144)}):
   root=Path(root);(root/'tiles').mkdir();Image.new('RGB',(64,36),'orange').save(root/'master.png')
   for r in range(2):
    for c in range(2):Image.new('RGB',(256,144),(60+r*30,120+c*20,90)).save(root/f'tiles/tile_r{r}_c{c}.png')
   args=SimpleNamespace(grid='2x2',canvas='384x160',tier='TEST',run=str(root),master=str(root/'master.png'),inset=(0,0),batch_tiles=1,reset=False)
   mosaic.cmd_build(args);original=mosaic.atomic_json
   def interrupted(path,value):
    if path.name=='state.json' and len(value['report'])==2:raise KeyboardInterrupt
    return original(path,value)
   with patch.object(mosaic,'atomic_json',side_effect=interrupted):
    with self.assertRaises(KeyboardInterrupt):mosaic.cmd_build(args)
   self.assertTrue((root/'.composition/pending.json').exists())
   for _ in range(4):mosaic.cmd_build(args)
   before=(root/'mosaic.png').read_bytes()
   # A compositor-version change forces a clean rebuild of identical source images.
   args.reset=True
   with patch.object(mosaic,'COMPOSITION_VERSION','test-rebuild'):
    for _ in range(5):mosaic.cmd_build(args)
   self.assertEqual((root/'mosaic.png').read_bytes(),before)
 def test_interruption_during_reset_initialization_retries_cleanup(self):
  with tempfile.TemporaryDirectory()as root, patch.dict(mosaic.TIER_SIZE, {'TEST':(256,144)}):
   root=Path(root);(root/'tiles').mkdir();Image.new('RGB',(64,36),'orange').save(root/'master.png')
   for r in range(2):
    for c in range(2):Image.new('RGB',(256,144),(60+r*30,120+c*20,90)).save(root/f'tiles/tile_r{r}_c{c}.png')
   args=SimpleNamespace(grid='2x2',canvas='384x160',tier='TEST',run=str(root),master=str(root/'master.png'),inset=(0,0),batch_tiles=1,reset=False)
   for _ in range(5):mosaic.cmd_build(args)
   Image.new('RGB',(256,144),'blue').save(root/'tiles/tile_r1_c1.png');args.reset=True;original=mosaic.atomic_json
   def interrupted(path,value):
    original(path,value)
    if path.name=='state.json' and value.get('initializing'):raise KeyboardInterrupt
   with patch.object(mosaic,'atomic_json',side_effect=interrupted):
    with self.assertRaises(KeyboardInterrupt):mosaic.cmd_build(args)
   args.reset=False
   self.assertEqual(mosaic.cmd_build(args)['completed_tiles'],1)
   self.assertFalse((root/'mosaic.png').exists());self.assertFalse((root/'composition-validation.json').exists())
   self.assertFalse(json.loads((root/'.composition/state.json').read_text())['initializing'])
if __name__=='__main__':unittest.main()
