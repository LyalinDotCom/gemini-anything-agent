import { expect, test, vi } from 'vitest';
const mock = vi.hoisted(() => ({ ensure:vi.fn(), get:vi.fn().mockRejectedValue({status:404}), create: vi.fn().mockRejectedValue({status:503,message:'fixture outage'}) }));
vi.mock('../src/gemini/client', () => ({ ai: () => ({interactions:{create:mock.create,get:mock.get}}), resolveApiKey: () => 'fixture-key' }));
vi.mock('../src/gemini/agents', () => ({ agentWorkflowFingerprint: (model:string) => model, ensureManagedAgent: mock.ensure }));
vi.mock('../src/storage/messages', () => ({loadTranscript:async()=>[],putMedia:vi.fn(),mediaId:()=>'',listMessages:async()=>[],saveMessages:async()=>{},saveTranscript:async()=>{}}));
import { useStore } from '../src/state/store';
import { sendTurn } from '../src/chat/controller';
import { HARNESS_MODELS, MODELS } from '../src/models';
import { DEFAULT_RUN_OPTIONS } from '../src/state/types';

test.each(HARNESS_MODELS)('baseline controller sends $label through agent_config', async model => {
  mock.create.mockClear();
  const sid=useStore.getState().createSession('chat','antigravity');
  useStore.getState().patchSession(sid,{agentMode:'antigravity',runOptions:{...DEFAULT_RUN_OPTIONS,agentModel:model.id}});
  await sendTurn(sid,{text:'Compute six times seven.'});
  const body=mock.create.mock.calls[0][0];
  expect(body.agent).toBe(MODELS.chatAgentBase);
  expect(body.agent_config).toEqual({type:'antigravity',model:model.id});
  expect(body.model).toBeUndefined();
  expect(useStore.getState().sessions[sid].modelUsed).toBe(model.id);
  const other=HARNESS_MODELS.find(candidate=>candidate.id!==model.id)!;
  useStore.getState().patchSession(sid,{runOptions:{...DEFAULT_RUN_OPTIONS,agentModel:other.id}});
  await sendTurn(sid,{text:'Retry after stopping or failure.'});
  expect(mock.create.mock.calls.at(-1)![0].agent_config.model).toBe(model.id);
});

test('custom-agent retries keep the creation model and cannot add runtime overrides', async()=>{
 mock.create.mockClear();mock.ensure.mockClear();
 mock.ensure.mockResolvedValue({agentId:'gaa-anywhere-v1-4-argon',baseAgent:MODELS.chatAgentBase,reasoningModel:MODELS.reasoning,degraded:false,action:'reused'});
 const sid=useStore.getState().createSession('chat','anywhere');
 useStore.getState().patchSession(sid,{agentMode:'anywhere',runOptions:{...DEFAULT_RUN_OPTIONS,agentModel:MODELS.reasoning}});
 await sendTurn(sid,{text:'First custom-agent turn.'});
 useStore.getState().patchSession(sid,{runOptions:{...DEFAULT_RUN_OPTIONS,agentModel:MODELS.text}});
 await sendTurn(sid,{text:'Retry custom-agent turn.'});
 expect(mock.ensure.mock.calls.map(call=>call[3])).toEqual([MODELS.reasoning,MODELS.reasoning]);
 for(const [body] of mock.create.mock.calls){expect(body.agent).toBe('gaa-anywhere-v1-4-argon');expect(body.agent_config).toBeUndefined();}
});
test('the pinned model survives the actual Zustand persistence and rehydration path', async()=>{
 const sid=useStore.getState().createSession();
 useStore.getState().patchSession(sid,{modelUsed:MODELS.reasoning,runOptions:{...DEFAULT_RUN_OPTIONS,agentModel:MODELS.text}});
 const snapshot=localStorage.getItem('gaa-store')!;
 expect(JSON.parse(snapshot).state.sessions[sid].modelUsed).toBe(MODELS.reasoning);
 useStore.setState({sessions:{},sessionOrder:[],activeSessionId:null});
 localStorage.setItem('gaa-store',snapshot);
 await useStore.persist.rehydrate();
 expect(useStore.getState().sessions[sid].modelUsed).toBe(MODELS.reasoning);
});

test('an acknowledged failed first turn keeps its workflow and workspace on retry',async()=>{
 mock.create.mockClear();
 mock.create.mockImplementation(async()=> (async function*(){
  yield {event_type:'interaction.created',interaction:{id:'failed-first',status:'in_progress',environment_id:'kept-workspace'}};
  yield {event_type:'interaction.failed',interaction:{id:'failed-first',status:'failed',environment_id:'kept-workspace',error:{message:'Fixture failure'}}};
 })());
 const id=useStore.getState().createSession('chat','antigravity');await sendTurn(id,{text:'First turn'});
 expect(useStore.getState().sessions[id].agentPayloadFingerprint).toBe(MODELS.text);
 expect(useStore.getState().sessions[id].environmentId).toBe('kept-workspace');
 mock.create.mockRejectedValue({status:503});await sendTurn(id,{text:'Retry in the same workspace'});
 const body=mock.create.mock.calls.at(-1)![0];expect(body.environment).toBe('kept-workspace');
 expect(useStore.getState().sessions[id].migrationContext).toBeFalsy();
});

test('recovering an existing run preserves a newly submitted prompt as a draft retry',async()=>{
 mock.create.mockClear();const id=useStore.getState().createSession('chat','antigravity');
 useStore.getState().patchSession(id,{pending:{interactionId:'previous-run',messageId:'previous-reply',startedAt:Date.now()}});
 await sendTurn(id,{text:'Do not discard this next request',attachments:[{kind:'image',mediaId:'uploaded-image',mimeType:'image/png',base64:'AAAA'}]});
 const retry=useStore.getState().retryMessages[id];expect(retry?.parts).toContainEqual(expect.objectContaining({kind:'text',text:'Do not discard this next request'}));
 expect(retry?.parts).toContainEqual(expect.objectContaining({kind:'image',mediaId:'uploaded-image'}));expect(mock.create).not.toHaveBeenCalled();
});

test('a delayed animation frame cannot overwrite a finished reply',async()=>{
 const frames:FrameRequestCallback[]=[];
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.push(callback);return frames.length;});
 mock.create.mockImplementation(async()=> (async function*(){
  yield {event_type:'interaction.created',interaction:{id:'frame-run',status:'in_progress'}};
  yield {event_type:'step.start',index:0,step:{type:'code_execution_call',id:'call',code:'print(42)'}};
  yield {event_type:'interaction.failed',interaction:{id:'frame-run',status:'failed',error:{message:'Fixture failure'}}};
 })());
 try {
  const id=useStore.getState().createSession('chat','antigravity');await sendTurn(id,{text:'Test the hidden-tab frame'});
  const before=useStore.getState().messages[id].at(-1)!;expect(before.status).toBe('error');
  const parts=structuredClone(before.parts);for(const callback of frames)callback(0);
  expect(useStore.getState().messages[id].at(-1)!.parts).toEqual(parts);
 } finally {vi.unstubAllGlobals();}
});

test('a silent stored stream polls the existing run instead of creating a duplicate',async()=>{
 vi.useFakeTimers();mock.create.mockClear();mock.get.mockResolvedValue({id:'silent-run',status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'Recovered answer'}]}]});
 mock.create.mockImplementation(async()=>({[Symbol.asyncIterator]:()=>{let first=true;return{next:async()=>{if(first){first=false;return{done:false,value:{event_type:'interaction.created',interaction:{id:'silent-run',status:'in_progress'}}};}return new Promise(()=>{});},return:async()=>({done:true})};}}));
 try {
  const id=useStore.getState().createSession('chat','antigravity');const run=sendTurn(id,{text:'Track the existing run'});
  await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(30_000);await run;
  expect(mock.create).toHaveBeenCalledOnce();expect(useStore.getState().streaming[id]).toBe(false);
  expect(useStore.getState().messages[id].at(-1)?.parts).toContainEqual(expect.objectContaining({kind:'text',text:'Recovered answer'}));
 } finally {vi.useRealTimers();}
});
