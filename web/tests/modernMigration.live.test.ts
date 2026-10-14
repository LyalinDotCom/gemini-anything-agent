import {test,expect} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {ai} from '../src/gemini/client';
import {ensureManagedAgent} from '../src/gemini/agents';
import {buildInteractionParams} from '../src/gemini/interactionParams';
import {asEventStream,consumeInteractionStream,blocksFromInteraction} from '../src/gemini/streamAdapter';
import {listOutputFiles,downloadOutputFile} from '../src/gemini/envFiles';
test.skipIf(process.env.MODERN_MIGRATION_LIVE!=='1')('official CLI generates and transcribes artifacts inside a managed Linux agent',async()=>{
 const root='../outputs/modern-migration';mkdirSync(root,{recursive:true});
 const prior=JSON.parse((await import('node:fs')).readFileSync('../outputs/modern-cli/run.json','utf8'));
 const agentId='test-modern-migration-'+Date.now();const agent=await ensureManagedAgent(agentId,null);expect(agent.degraded).toBe(false);
 const prompt=`Workspace upgrade verification ONLY; no new media generation. This is a fresh official-CLI workspace. The original environment ${prior.environmentId} contains /workspace/output/modern/image.png. Discover bash /.agents/bin/gemini-api environments files download --help, recover that existing image into /workspace/output/modern/recovered-image.png with the official CLI, and verify it decodes at2752x1536. Use native processing only. Save migration-proof.json with passed=true, previous_workspace_preserved=true and the actual recovered-file SHA256. Confirm /.agents/bin/gai is absent. Finish immediately; no metadata hunts or new image/model generation.`;
 const response=await ai().interactions.create(buildInteractionParams({agent:agentId,input:prompt,store:true,background:true,stream:true})as never,{maxRetries:0,timeout_ms:20*60_000}as never);
 let id='';let env='';let outcome=await consumeInteractionStream(asEventStream(response),(blocks,meta)=>{id=meta.interactionId||id;env=meta.environmentId||env;writeFileSync(root+'/run.json',JSON.stringify({agentId,interactionId:id,environmentId:env}));writeFileSync(root+'/progress.json',JSON.stringify({blocks,meta}));},{stallMs:5*60_000});
 while(['running','in_progress','queued','pending'].includes(outcome.status)){await new Promise(r=>setTimeout(r,4000));outcome=blocksFromInteraction(await ai().interactions.get(id)as Record<string,unknown>);}
 writeFileSync(root+'/outcome.json',JSON.stringify(outcome));expect(outcome.status).toBe('completed');env=outcome.environmentId||env;const files=await listOutputFiles(env);
 for(const file of files.filter(f=>f.path.includes('/modern/'))){const entry=await downloadOutputFile(env,file);writeFileSync(root+'/'+file.path.split('/').pop(),entry.data);}
 expect(files.some(f=>f.path.endsWith('migration-proof.json'))).toBe(true);expect(files.some(f=>f.path.endsWith('recovered-image.png'))).toBe(true);
},25*60_000);
