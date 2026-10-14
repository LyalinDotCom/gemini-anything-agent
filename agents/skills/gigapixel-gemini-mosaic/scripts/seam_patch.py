"""Native crop extraction/assembly only. Gemini edits happen through the published CLI."""
import argparse, hashlib, json, os, shutil
from pathlib import Path
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

def digest(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def main():
    p=argparse.ArgumentParser(description=__doc__,epilog="prepare writes <run>/seam-repairs/<name>-input.png. Use each as an actual published CLI image-edit reference; save native-size <name>-edited.jpg and CLI JSON <name>-response.json in the same directory. apply preserves128px context, blends32px, and writes seam-repair-validation.json. One consolidated spec per run; retries are idempotent.")
    p.add_argument('command',choices=['prepare','apply']);p.add_argument('--run',required=True)
    p.add_argument('--spec',required=True,help='JSON array of {name, box:[left,top,right,bottom]} at native resolution')
    p.add_argument('--allow-overlap',action='store_true',help='Only for deliberately overlapping unchanged context; visually inspect shared boundaries.')
    a=p.parse_args();run=Path(a.run);out=run/'seam-repairs';out.mkdir(exist_ok=True)
    specs=json.loads(Path(a.spec).read_text());base=out/'before.png'
    spec_state=out/'spec.json'
    if spec_state.exists() and json.loads(spec_state.read_text())!=specs:
        raise ValueError('This run already has a different repair spec. Use one consolidated spec; incremental replacements would discard earlier repairs.')
    # Save the spec only after every bound/name has been validated.
    if not base.exists():
        if a.command!='prepare':raise ValueError('Run prepare first')
        # Preserve an independent base atomically; an interrupted copy cannot become the baseline.
        temporary_base=out/'before.tmp.png'
        shutil.copyfile(run/'mosaic.png',temporary_base);os.replace(temporary_base,base)
    current_sha=digest(run/'mosaic.png');base_sha=digest(base)
    previous_path=run/'seam-repair-validation.json'
    previous=json.loads(previous_path.read_text()) if previous_path.exists() else {}
    if current_sha not in {base_sha,previous.get('final_sha256'),previous.get('previous_sha256')}:
        raise ValueError('Mosaic changed since patch preparation; remove the durable seam-repairs folder and seam-repair-validation.json, then prepare fresh crops after rebuilding.')
    with Image.open(base) as src:
        canvas=src.convert('RGB');w,h=canvas.size
    names=set();records=[];boxes=[]
    for item in specs:
        name=item['name'];box=item['box']
        if not isinstance(name,str) or not name.replace('-','').replace('_','').isalnum() or name in names:raise ValueError('Invalid/duplicate patch name')
        names.add(name)
        if len(box)!=4 or any(type(v)!=int for v in box):raise ValueError('Invalid bounds')
        x,y,r,b=box
        if not (0<=x<r<=w and 0<=y<b<=h) or min(r-x,b-y)<512:raise ValueError('Patch outside canvas or too small')
        if not a.allow_overlap and any(x<q[2] and r>q[0] and y<q[3] and b>q[1] for q in boxes):raise ValueError('Patch boxes overlap; merge them or explicitly allow unchanged context overlap.')
        boxes.append(box)
    if not spec_state.exists():
        temp=out/'spec.tmp.json';temp.write_text(json.dumps(specs));os.replace(temp,spec_state)
    names=set()
    for s in specs:
        name=s['name'];box=s['box']
        if not name.replace('-','').replace('_','').isalnum() or name in names:raise ValueError('Invalid/duplicate patch name')
        names.add(name)
        if len(box)!=4 or any(type(v)!=int for v in box):raise ValueError('Invalid bounds')
        x,y,r,b=box
        if not (0<=x<r<=w and 0<=y<b<=h) or min(r-x,b-y)<512:raise ValueError('Patch outside canvas or too small')
        if a.command=='prepare':canvas.crop(box).save(out/(name+'-input.png'))
        else:
            edited=out/(name+'-edited.jpg')
            response=out/(name+'-response.json')
            metadata=json.loads(response.read_text())
            if not isinstance(metadata,dict) or metadata.get('error') or not (metadata.get('ok') is True or (metadata.get('path') and (metadata.get('response_id') or metadata.get('interaction_id')))):raise ValueError('Missing successful actual CLI response metadata')
            reference=out/(name+'-input.png')
            with Image.open(reference) as image,Image.open(base) as baseline:
                if image.size!=(r-x,b-y) or not np.array_equal(np.asarray(image.convert('RGB')),np.asarray(baseline.crop(box).convert('RGB'))):
                    raise ValueError('Prepared crop no longer matches the base and bounds')
            records.append(dict(s,input_sha256=digest(reference),edited_sha256=digest(edited),cli_response_file=response.name,response_sha256=digest(response)))
            with Image.open(edited) as im:
                if im.size!=(r-x,b-y):raise ValueError('Edited patch must retain exact native dimensions; no upscaling')
                patch=np.asarray(im.convert('RGB'),dtype=np.float32)
            original=np.asarray(canvas.crop(box),dtype=np.float32)
            # Preserve a 128px context frame; blend only a 32px transition inside it.
            yy,xx=np.indices((b-y,r-x));distances=[]
            if x>0:distances.append(xx)
            if y>0:distances.append(yy)
            if r<w:distances.append(r-x-1-xx)
            if b<h:distances.append(b-y-1-yy)
            distance=np.minimum.reduce(distances) if distances else np.full(xx.shape,160)
            mask=np.clip((distance-128)/32,0,1).astype(np.float32)[...,None]
            assembled=np.rint(original*(1-mask)+patch*mask).clip(0,255).astype(np.uint8)
            canvas.paste(Image.fromarray(assembled),(x,y))
    if a.command=='apply':
        tmp=run/'mosaic.patch-tmp.png';canvas.save(tmp);png_tmp=tmp
        tmp=run/'mosaic.patch-tmp.jpg';canvas.save(tmp,quality=96,subsampling=0);jpg_tmp=tmp
        preview=canvas.copy();preview.thumbnail((2400,2400));preview_tmp=run/'preview.patch-tmp.jpg';preview.save(preview_tmp,quality=92)
        report={'method':'Gemini native crop edits, preserved128px context frame and32px boundary blend', 'base_sha256':base_sha,'previous_sha256':current_sha,'size':[w,h],'patches':records,'patch_order':[s['name'] for s in specs],'final_sha256':digest(png_tmp),'manual_visual_review_required':True}
        report_tmp=run/'seam-repair-validation.tmp.json';report_tmp.write_text(json.dumps(report,indent=2))
        # Record both old and new hashes before swapping images so interrupted delivery can resume.
        os.replace(report_tmp,previous_path);os.replace(png_tmp,run/'mosaic.png');os.replace(jpg_tmp,run/'mosaic.jpg');os.replace(preview_tmp,run/'preview_overview.jpg')
    print(json.dumps({'status':'prepared' if a.command=='prepare' else 'applied','patches':len(specs),'directory':str(out)}))
if __name__=='__main__':main()
