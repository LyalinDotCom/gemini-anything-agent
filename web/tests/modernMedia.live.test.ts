import {test,expect} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {ai} from '../src/gemini/client';
import {ensureManagedAgent} from '../src/gemini/agents';
import {buildInteractionParams} from '../src/gemini/interactionParams';
import {asEventStream,consumeInteractionStream,blocksFromInteraction} from '../src/gemini/streamAdapter';
import {listOutputFiles,downloadOutputFile} from '../src/gemini/envFiles';
test.skipIf(process.env.MODERN_MEDIA_LIVE!=='1')('official CLI generates and transcribes artifacts inside a managed Linux agent',async()=>{
 const root='../outputs/modern-media';mkdirSync(root,{recursive:true});
 const prior=JSON.parse((await import('node:fs')).readFileSync('../outputs/modern-cli/run.json','utf8'));const agentId=(await ensureManagedAgent(prior.agentId,null,false,'gemini-4-argon')).agentId;
 const prompt=`Second official CLI modernization live test. Use our existing managed environment; do not regenerate image or speech. All media calls ONLY through bash /.agents/bin/gemini-api. Discover video/music help together and generate exactly ONE short whimsical city video and ONE brief instrumental jingle using latest CLI defaults. Save their actual response JSON and output files under /workspace/output/modern. Use --output-format json, preserve actual returned paths/extensions. For video retain the operation ID and resume it if a polling call times out; never restart a known generation. Do not preflight inputs that do not exist yet. Then use ffmpeg headlessly to convert existing greeting.wav to MP3 (Task example), and build one self-contained responsive story.html that incorporates the existing image, music and narrated greeting (Story App/Web examples). Embed its images/audio as data URLs for a self-contained app and include usable play buttons plus a small interactive scene. Use native processing only for existing artifacts, never ffplay/SDL/GUI windows. Save metadata.json with actual files, CLI version and actual response IDs. Verify outputs without playing them in this headless sandbox. Finish immediately; no metadata hunts, no full3D orbit or49region world in this bounded test.`;
 const response=await ai().interactions.create(buildInteractionParams({agent:agentId,input:prompt,environmentId:prior.environmentId,store:true,background:true,stream:true})as never,{maxRetries:0,timeout_ms:20*60_000}as never);
 let id='';let env='';let outcome=await consumeInteractionStream(asEventStream(response),(blocks,meta)=>{id=meta.interactionId||id;env=meta.environmentId||env;writeFileSync(root+'/run.json',JSON.stringify({agentId,interactionId:id,environmentId:env}));writeFileSync(root+'/progress.json',JSON.stringify({blocks,meta}));},{stallMs:5*60_000});
 while(['running','in_progress','queued','pending'].includes(outcome.status)){await new Promise(r=>setTimeout(r,4000));outcome=blocksFromInteraction(await ai().interactions.get(id)as Record<string,unknown>);}
 writeFileSync(root+'/outcome.json',JSON.stringify(outcome));expect(outcome.status).toBe('completed');env=outcome.environmentId||env;const files=await listOutputFiles(env);
 for(const file of files.filter(f=>f.path.includes('/modern/'))){const entry=await downloadOutputFile(env,file);writeFileSync(root+'/'+file.path.split('/').pop(),entry.data);}
 expect(files.some(f=>f.path.endsWith('story.html'))).toBe(true);expect(files.some(f=>f.path.endsWith('.mp4'))).toBe(true);
},25*60_000);
