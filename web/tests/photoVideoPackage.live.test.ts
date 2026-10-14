import {afterAll,expect,test} from 'vitest';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {ai} from '../src/gemini/client';
import {ensureAgent,deleteAgent} from '../src/gemini/agents';
import {buildInteractionParams} from '../src/gemini/interactionParams';
import {asEventStream,consumeInteractionStream} from '../src/gemini/streamAdapter';
import {downloadSnapshot} from '../src/gemini/envFiles';
const env=process.env.PACKAGE_VIDEO_ENV;
const enabled=Boolean(env&&process.env.GEMINI_API_KEY);
const agentId=`test-photo-package-${Date.now()}`;let id='';
afterAll(async()=>{if(!enabled)return;if(id)await ai().interactions.delete(id).catch(()=>{});await deleteAgent(agentId).catch(()=>{});});
test.skipIf(!enabled)('package the visually verified Gemini full orbit entirely inside Linux',async()=>{
 await ensureAgent(agentId,null,true);
 const prepare=readFileSync('../agents/skills/photo-to-3d/prepare_photo_object.py','utf8');
 const blender=readFileSync('../agents/skills/photo-to-3d/photo_object_blender.py','utf8');
 const script=`import json,subprocess,sys\nfrom pathlib import Path\nimport numpy as np\nfrom PIL import Image\nfrom scipy import ndimage\nroot=Path('/tmp/verified-video-package');root.mkdir(exist_ok=True)\nframes=root/'frames';frames.mkdir(exist_ok=True)\nangles=np.arange(32)*11.25\ncurve=np.array([[0,0],[5,1],[25,1.3],[40,1.6],[60,1.9],[75,2.2],[90,2.6],[90.01,3.2],[105,3.6],[120,3.9],[135,4.2],[150,4.55],[170,4.9],[180,5.2],[180.01,6],[185,6.3],[200,6.65],[220,7],[245,7.35],[265,7.7],[280,8.05],[300,8.35],[315,8.7],[335,9],[350,9.35],[360,9.65]])\ntimes=np.interp(angles,curve[:,0],curve[:,1])\nfor i,t in enumerate(times):\n raw=root/f'raw-{i:03d}.png'\n subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-ss',str(t),'-i','/tmp/reference-orbit-retry.mp4','-frames:v','1','-vf','scale=-1:1080',str(raw)],check=True)\n im=Image.open(raw).convert('RGB'); rgb=np.array(im);\n # Native matte for this inspected studio reference: coloured skin/cat/shirt\n # and dark hair/pants/shoes; the grey floor and shadows are excluded.\n mask=(np.ptp(rgb.astype(np.int16),axis=2)>22)|(rgb.max(axis=2)<125)\n mask[:35]=False;mask[-35:]=False;mask[:,:35]=False;mask[:,-35:]=False\n labels,n=ndimage.label(mask); sizes=np.bincount(labels.ravel());sizes[0]=0\n mask=labels==sizes.argmax();mask=ndimage.binary_fill_holes(mask)\n alpha=np.rint(np.clip(ndimage.distance_transform_edt(mask)/1.4,0,1)*255).astype(np.uint8)\n Image.fromarray(np.dstack([rgb,alpha])).save(frames/f'frame-{i:03d}.png')\ncoverage={'asymmetric_subject':True,'azimuth_sign':1,'views':[{'file':f'frame-{i:03d}.png','angle_degrees':float(a),'source_time_seconds':float(t)} for i,(a,t) in enumerate(zip(angles,times))],'evidence':{'front':'frame-000.png','first_profile':'frame-008.png','back':'frame-016.png','opposite_profile':'frame-024.png'},'inspection':'Whole-source contact sheet independently checked: first profile faces LEFT, opposite profile RIGHT, back between them. Angles are estimated from observed milestones; not calibrated cameras.'}\n(root/'coverage.json').write_text(json.dumps(coverage))\nsubprocess.run([sys.executable,str(root/'prepare.py'),'--frames',str(frames),'--coverage',str(root/'coverage.json'),'--size','1080','--out',str(root/'prepared')],check=True)\n`;
 const prompt=[
 'Native processing only. Do NOT generate more images/video, retry a model, or inspect credentials. We already have a Gemini full-circle video generated through the official CLI inside this exact environment at /tmp/reference-orbit-retry.mp4. Its whole contact sheet has been independently visually checked: first profile faces LEFT, back in middle, opposite profile faces RIGHT. Preserve all original inputs and other outputs.',
 'Write the three exact supplied native source files into /tmp/verified-video-package. Run setup only if needed; native dependencies and Blender are already installed in this environment. Execute package.py with the existing /tmp/gaa-photo-to-3d/venv/bin/python. Capture logs under /tmp. The matte is specifically for this inspected grey-studio photograph; do not generalize it to other photos.',
 'Then execute Blender with the supplied blender.py, using prepared/photo-object.json and output /workspace/output/photo-objects/video-fixture/views, resolution 768, frames 32. Discover native helper help if needed. Encode motion frames into motion.mp4 then remove only those render frames. Reopen object.blend in a fresh Blender process to render verification.png. Keep denoising disabled.',
 'Inspect first, left, back and right photographic textures and rendered preview. Verify intact face/fur/shoes, true alpha, embedded PNGs, KHR_materials_unlit, angle metadata and complete circle. Save live-validation.json in views with cli_version 0.4.2, actual blender_version, generated_in_managed_agent true, views_reopened/full_circle_verified/opposite_profiles_verified based on actual checks. Save transfer-validation.json with each final file size/SHA256. No additional generative calls. Finish after these checks.',
 'SOURCE /tmp/verified-video-package/prepare.py\n'+prepare,
 'SOURCE /tmp/verified-video-package/blender.py\n'+blender,
 'SOURCE /tmp/verified-video-package/package.py\n'+script,
 ].join('\n\n');
 const local=resolve('../outputs/photo-object-v3/video-fixture');mkdirSync(local,{recursive:true});
 const stream=await ai().interactions.create(buildInteractionParams({agent:agentId,input:prompt,environmentId:env,store:true,background:true,stream:true}) as never,{maxRetries:0,timeout_ms:60*60_000} as never);
 let outcome=await consumeInteractionStream(asEventStream(stream),(blocks,meta)=>{if(meta.interactionId)id=meta.interactionId;writeFileSync(`${local}/run.json`,JSON.stringify({agentId,interactionId:id,environmentId:env}));writeFileSync(`${local}/progress.json`,JSON.stringify({blocks,meta}));},{stallMs:20*60_000});
 while(['queued','pending','running','in_progress'].includes(outcome.status)){await new Promise(r=>setTimeout(r,4000));const got=await ai().interactions.get(id);const {blocksFromInteraction}=await import('../src/gemini/streamAdapter');outcome=blocksFromInteraction(got as Record<string,unknown>);}
 writeFileSync(`${local}/outcome.json`,JSON.stringify(outcome));expect(outcome.status).toBe('completed');
 const entries=await downloadSnapshot(outcome.environmentId||env!,true);
 for(const e of entries){if(!e.name.includes('/photo-objects/video-fixture/views/'))continue;writeFileSync(`${local}/${e.name.split('/').pop()}`,e.data);}
 for(const name of ['object.glb','object.blend','preview.png','verification.png','motion.mp4','photo-object.json','live-validation.json','transfer-validation.json'])expect(readFileSync(`${local}/${name}`).length).toBeGreaterThan(20);
 const report=JSON.parse(readFileSync(`${local}/photo-object.json`,'utf8'));expect(report.textures.length).toBe(32);expect(report.coverage.azimuth_sign).toBe(1);
},60*60_000);
