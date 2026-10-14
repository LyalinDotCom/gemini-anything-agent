import { expect, test, vi } from 'vitest';
const mock = vi.hoisted(() => ({ ensure:vi.fn(), create: vi.fn().mockRejectedValue({status:503,message:'fixture outage'}) }));
vi.mock('../src/gemini/client', () => ({ ai: () => ({interactions:{create:mock.create}}), resolveApiKey: () => 'fixture-key' }));
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
