import {afterAll,expect,test} from 'vitest';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {ai} from '../src/gemini/client';
import {ensureAgent,deleteAgent} from '../src/gemini/agents';
import {buildInteractionParams} from '../src/gemini/interactionParams';
import {prepareObject3dPhotos} from '../src/gemini/object3dInputs';
import {object3dPhotoContext} from '../../shared/object3dInputs';
import {OBJECT3D_INVOCATION,object3dMethodInstruction} from '../../shared/object3dProfile';
import {asEventStream,consumeInteractionStream} from '../src/gemini/streamAdapter';
import {downloadSnapshot} from '../src/gemini/envFiles';
const enabled=Boolean(process.env.CANONICAL_PHOTO && process.env.GEMINI_API_KEY);
const agentId=`test-photo-canonical-${Date.now()}`;
let interactionId='';
afterAll(async()=>{if(!enabled)return;if(interactionId)await ai().interactions.delete(interactionId).catch(()=>{});await deleteAgent(agentId).catch(()=>{});});
test.skipIf(!enabled)('explicit Gemini photographs cover both opposite profiles and package in Linux Blender',async()=>{
 const photo=readFileSync(process.env.CANONICAL_PHOTO!);
 const input=[{type:'image',mime_type:'image/jpeg',data:photo.toString('base64')}];
 const agent=await ensureAgent(agentId,null,true);expect(agent.degraded).toBe(false);
 const prepared=await prepareObject3dPhotos(input);
 const local=resolve('../outputs/photo-object-v3/canonical');mkdirSync(local,{recursive:true});
 const prompt=[
 'Create the complete 3D View of this exact person holding the cat. Two full-orbit video tests already failed by retracing one side, even with explicit milestones. Use the skill fallback now: a coherent set of 32 explicit-angle Gemini photographic images, NO more video retries. All calls must run through the mounted official Gemini CLI inside this managed Linux agent.',
 'Discover CLI image help once. Render the frontal isolated reference from the verified original photo reference using actual image input, portrait 9:16, 2K, pure uniform unlit bright magenta background with NO floor, NO shadows, head-to-shoes subject occupying 65–75% of the image height. Preserve original person identity, smile, teal shirt, dark trousers, shoes, hands, orange cat and their exact contact/pose. Inspect and validate isolation.',
 'Generate the other 31 angles, every11.25 degrees, using both original photo and isolated front as image references. Explicit yaw:0 front;90 person faces screen RIGHT in profile;180 BACK with face not visible;270 person faces screen LEFT in profile;315 front three-quarter facing LEFT. Intermediate angles follow that same monotonic turn. Never mirror pixels or use the same profile twice. Keep camera height, lens, lighting, pose, wardrobe, cat, magenta background and full-length margins consistent. Do not change the pose, animate the cat, or transfer it between arms. Render clean natural photographs.',
 'Run independent published CLI image commands in bounded parallel batches of4, capture logs under/tmp and return just success counts. Save angle files zero-padded under/tmp/canonical-views. Generate the first image before the remaining calls so all use its identity/framing anchor. Retry only failed individual images. No custom model REST calls, no alternate image models, no hosted3D services.',
 'Inspect a contact sheet with all32 images. Both profiles MUST face opposite screen directions, back must show the back of the shirt/head. Record actual observed coverage with asymmetric_subject:true and filenames/angle_degrees, and four evidence filenames. Reject wrong-angle images and regenerate those individually. Never fabricate coverage metadata.',
 'Use the mounted native setup and preparation/Blender helpers. prepare_photo_object now aligns mixed image sizes on a common transparent canvas; keep textures at1080 maximum. Package ONLY views/ under/workspace/output/photo-objects/canonical-views. Capture Blender logs under/tmp. Use768 preview and32 motion frames. Create object.glb,object.blend,preview.png,motion.mp4,photo-object.json. Reopen saved Blender in a fresh process for verification.png. Keep native caches and individual PNG textures outside/workspace, under/tmp. Save the source isolated-reference.jpg and live-validation.json with cli_version,blender_version,generated_in_managed_agent,views_reopened,full_circle_verified,opposite_profiles_verified all truthful. Report failure plainly if coverage cannot be completed.'
 ].join('\n');
 const params=buildInteractionParams({agent:agentId,input:[...input,{type:'text',text:prompt}],systemInstruction:[OBJECT3D_INVOCATION,object3dMethodInstruction('views'),object3dPhotoContext(prepared.photos)].join('\n'),environmentId:prepared.environmentId,store:true,background:true,stream:true});
 const stream=await ai().interactions.create(params as never,{maxRetries:0,retries:{strategy:'none'},timeout_ms:60*60_000} as never);
 const outcome=await consumeInteractionStream(asEventStream(stream),(blocks,meta)=>{
   if(meta.interactionId)interactionId=meta.interactionId;
   writeFileSync(`${local}/run.json`,JSON.stringify({agentId,interactionId,environmentId:prepared.environmentId}));
   writeFileSync(`${local}/progress.json`,JSON.stringify({blocks,meta}));
 },{stallMs:20*60_000});
 writeFileSync(`${local}/outcome.json`,JSON.stringify(outcome));expect(outcome.status).toBe('completed');
 const entries=await downloadSnapshot(outcome.environmentId||prepared.environmentId,true);
 for(const entry of entries){if(!entry.name.includes('/photo-objects/canonical-views/'))continue;const name=entry.name.split('/').pop()!;writeFileSync(`${local}/${name}`,entry.data);}
 for(const name of ['object.glb','object.blend','preview.png','motion.mp4','photo-object.json','verification.png','live-validation.json'])expect(readFileSync(`${local}/${name}`).length).toBeGreaterThan(20);
 const manifest=JSON.parse(readFileSync(`${local}/photo-object.json`,'utf8'));expect(manifest.textures.length).toBe(32);expect(manifest.coverage.evidence.opposite_profile).toBeTruthy();
 const check=JSON.parse(readFileSync(`${local}/live-validation.json`,'utf8'));expect(check.generated_in_managed_agent).toBe(true);expect(check.full_circle_verified).toBe(true);expect(check.opposite_profiles_verified).toBe(true);expect(check.views_reopened).toBe(true);
},60*60_000);
