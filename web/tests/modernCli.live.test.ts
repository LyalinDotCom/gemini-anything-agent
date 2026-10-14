import {test,expect} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {ai} from '../src/gemini/client';
import {ensureManagedAgent} from '../src/gemini/agents';
import {buildInteractionParams} from '../src/gemini/interactionParams';
import {asEventStream,consumeInteractionStream,blocksFromInteraction} from '../src/gemini/streamAdapter';
import {listOutputFiles,downloadOutputFile} from '../src/gemini/envFiles';
test.skipIf(process.env.MODERN_CLI_LIVE!=='1')('official CLI generates and transcribes artifacts inside a managed Linux agent',async()=>{
 const root='../outputs/modern-cli';mkdirSync(root,{recursive:true});
 const agentId='test-modern-official-'+Date.now();const agent=await ensureManagedAgent(agentId,null);expect(agent.degraded).toBe(false);
 const prompt=`Live official CLI web modernization test. All model/media calls MUST happen inside this managed Linux agent through bash /.agents/bin/gemini-api. GAI is retired and not mounted. Use code_execution only. First discover official root/image/tts/transcribe help together, then run the actual commands with supported flags. Save exact structured JSON responses. Generate a native2K16:9 detailed small whimsical illustrated neighbourhood into /workspace/output/modern/image.png (latest default image model), and a brief spoken WAV greeting into /workspace/output/modern/greeting.wav, then transcribe THAT WAV into /workspace/output/modern/transcript.md. Use --output-format json for media response reports, not retired --json/--aspect/--mime flags. Inspect output paths returned by official CLI because it may choose extensions. Save CLI version via version subcommand to /workspace/output/modern/cli-version.txt. Do not print any authentication settings or env vars. Use no host model generator, REST wrapper or third-party hosted service. Use native tools to verify image dimensions and audio signatures if needed. Deliver metadata JSON listing actual artifacts and real CLI model/response IDs, finish after those THREE model operations. Do not generate a49-region world in this initial smoke test.`;
 const response=await ai().interactions.create(buildInteractionParams({agent:agentId,input:prompt,store:true,background:true,stream:true})as never,{maxRetries:0,timeout_ms:20*60_000}as never);
 let id='';let env='';let outcome=await consumeInteractionStream(asEventStream(response),(blocks,meta)=>{id=meta.interactionId||id;env=meta.environmentId||env;writeFileSync(root+'/run.json',JSON.stringify({agentId,interactionId:id,environmentId:env}));writeFileSync(root+'/progress.json',JSON.stringify({blocks,meta}));},{stallMs:5*60_000});
 while(['running','in_progress','queued','pending'].includes(outcome.status)){await new Promise(r=>setTimeout(r,4000));outcome=blocksFromInteraction(await ai().interactions.get(id)as Record<string,unknown>);}
 writeFileSync(root+'/outcome.json',JSON.stringify(outcome));expect(outcome.status).toBe('completed');env=outcome.environmentId||env;const files=await listOutputFiles(env);
 for(const file of files.filter(f=>f.path.includes('/modern/'))){const entry=await downloadOutputFile(env,file);writeFileSync(root+'/'+file.path.split('/').pop(),entry.data);}
 expect(files.some(f=>f.path.endsWith('transcript.md'))).toBe(true);expect(files.some(f=>/image\.(png|jpg|jpeg)$/.test(f.path))).toBe(true);
},25*60_000);
