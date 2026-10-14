import { expect, test, vi } from 'vitest';
const mock = vi.hoisted(() => ({ create: vi.fn().mockRejectedValue({status:503,message:'fixture outage'}) }));
vi.mock('../src/gemini/client', () => ({ ai: () => ({interactions:{create:mock.create}}), resolveApiKey: () => 'fixture-key' }));
vi.mock('../src/gemini/agents', () => ({ agentWorkflowFingerprint: (model:string) => model, ensureManagedAgent: () => {throw new Error('Baseline must use the base harness directly');} }));
vi.mock('../src/storage/messages', () => ({putMedia:vi.fn(),mediaId:()=>'',listMessages:async()=>[],saveMessages:async()=>{},saveTranscript:async()=>{}}));
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
});
