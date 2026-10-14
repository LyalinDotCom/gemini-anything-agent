"""Package existing large-image artifacts and actual provenance; no model calls."""
import argparse, hashlib, json, os, shutil, tempfile, uuid
from pathlib import Path
from PIL import Image
Image.MAX_IMAGE_PIXELS=None

def sha(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()

def cli_succeeded(metadata):
 if not isinstance(metadata,dict) or metadata.get('error') or metadata.get('ok') is False:return False
 return metadata.get('ok') is True or (isinstance(metadata.get('path'),str) and bool(metadata.get('response_id') or metadata.get('interaction_id')))

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--run',required=True);p.add_argument('--output',required=True)
 p.add_argument('--skills',nargs='+',required=True)
 a=p.parse_args();run=Path(a.run);output=Path(a.output)
 if run.resolve()==output.resolve() or run.resolve() in output.resolve().parents or output.resolve() in run.resolve().parents:raise ValueError('Keep durable working inputs separate from output')
 composition=json.loads((run/'composition-validation.json').read_text())
 qa=json.loads((run/'qa/summary.json').read_text())
 with Image.open(run/'mosaic.png') as image:size=list(image.size);image.load()
 with Image.open(run/'mosaic.jpg') as image:
  if list(image.size)!=size:raise ValueError('PNG/JPEG dimensions differ')
  image.load()
 inputs=composition['native_inputs']
 if len(inputs)!=composition['generated_tiles']:raise ValueError('Generated input count mismatch')
 reports=[]
 base_responses=[]
 for item in inputs:
  row,col=item['rc'];tile=run/f'tiles/tile_r{row}_c{col}.png'
  if sha(tile)!=item['sha256']:raise ValueError('Generated input changed after composition')
  base_responses.append(run/f'responses/resp_r{row}_c{col}.json')
 # Only publish selected non-secret fields from actual existing CLI responses.
 repair=run/'seam-repair-validation.json'
 repair_detail=json.loads(repair.read_text()) if repair.exists() else {}
 used_repair_responses=[run/'seam-repairs'/item['cli_response_file'] for item in repair_detail.get('patches',[])]
 response_ids=set()
 for path in base_responses+used_repair_responses:
  metadata=json.loads(path.read_text())
  if not cli_succeeded(metadata):raise ValueError('CLI response is missing or failed: '+path.name)
  response_id=metadata.get('response_id') or metadata.get('interaction_id')
  if response_id and response_id in response_ids:raise ValueError('Duplicate generation response ID')
  if response_id:response_ids.add(response_id)
  reports.append({'file':str(path.relative_to(run)),'sha256':sha(path),'model':metadata.get('model'),'ok':True,'response_format':'legacy' if metadata.get('ok') is True else 'gemini-api-cli','response_id':metadata.get('response_id') or metadata.get('interaction_id')})
 for name in ['mosaic.jpg','preview_overview.jpg','deepzoom.zip','qa/summary.json']:
  if (run/name).stat().st_mtime_ns<(run/'mosaic.png').stat().st_mtime_ns:raise ValueError('Derived artifact predates final PNG: '+name)
 final={name:{'bytes':(run/name).stat().st_size,'sha256':sha(run/name)} for name in ['mosaic.png','mosaic.jpg','preview_overview.jpg','deepzoom.zip']}
 validation={'size':size,'megapixels':round(size[0]*size[1]/1e6,3),'generated_regions':composition['generated_tiles'],'skills':a.skills,'base_composition':composition,'qa':qa,'cli_responses':reports,'cli_version':(run/'cli-version.txt').read_text().strip() if (run/'cli-version.txt').exists() else None,'final_artifacts':final,'finalized_in_managed_agent':Path('/.agents/AGENTS.md').exists(),'manual_visual_review_required':True}
 repair=run/'seam-repair-validation.json'
 if repair.exists():
  detail=json.loads(repair.read_text())
  if detail['final_sha256']!=final['mosaic.png']['sha256']:raise ValueError('Repair provenance does not match final image')
  for item in detail['patches']:
   response=run/'seam-repairs'/item['cli_response_file']
   metadata=json.loads(response.read_text())
   if not cli_succeeded(metadata):raise ValueError('Missing successful seam repair response')
   if item.get('response_sha256') and sha(response)!=item['response_sha256']:raise ValueError('Seam repair response changed')
  if detail['base_sha256']!=composition.get('mosaic_sha256'):raise ValueError('Repair base differs from the native composition')
  validation['seam_repairs']=detail
 if not repair.exists() and final['mosaic.png']['sha256']!=composition.get('mosaic_sha256'):raise ValueError('PNG differs from native composition; rebuild with current helper')
 output.parent.mkdir(parents=True,exist_ok=True)
 backup=None
 staged=Path(tempfile.mkdtemp(prefix='.'+output.name+'.delivery-',dir=run))
 try:
  for name in list(final)+['world_plan.json','composition-validation.json','geometry.json','build_report.json','seam-repair-validation.json']:
   source=run/name
   if source.exists():
    shutil.copyfile(source,staged/name)
  shutil.copytree(run/'qa',staged/'qa')
  (staged/'validation.json').write_text(json.dumps(validation,indent=2))
  if output.exists():
   previous=run/'.previous-deliveries';previous.mkdir(exist_ok=True);backup=previous/uuid.uuid4().hex;os.replace(output,backup)
  os.replace(staged,output)
 except Exception:
  if backup and backup.exists() and not output.exists():os.replace(backup,output)
  raise
 finally:
  if staged.exists():shutil.rmtree(staged)
 print(json.dumps({'status':'delivered','output':str(output),'size':size,'regions':composition['generated_tiles'],'manual_visual_review_required':True}))
if __name__=='__main__':main()
