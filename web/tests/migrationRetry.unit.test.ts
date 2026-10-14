import { expect, test, vi } from 'vitest';
const mock = vi.hoisted(() => ({ degraded: false, create: vi.fn().mockRejectedValue({ status: 503, message: 'temporary outage' }) }));
vi.mock('../src/gemini/client', () => ({ ai: () => ({ interactions: { create: mock.create } }), resolveApiKey: () => 'fixture-key' }));
vi.mock('../src/gemini/agents', () => ({ agentWorkflowFingerprint: () => 'updated-payload', ensureManagedAgent: async () => ({ agentId: 'gaa-anywhere-v1', baseAgent: 'antigravity-preview-09-2026', degraded: mock.degraded, action: 'reused' }) }));
vi.mock('../src/storage/messages', () => ({ loadTranscript:async()=>[], putMedia: vi.fn(), mediaId: () => '', listMessages: async () => [], saveMessages: async () => {}, saveTranscript: async () => {} }));
import { useStore } from '../src/state/store';
import { sendTurn } from '../src/chat/controller';

test('failed migration retains the old workspace reference and an outage retry cannot discard it', async () => {
  const sid = useStore.getState().createSession('chat', 'anywhere');
  useStore.getState().patchSession(sid, { agentMode: 'anywhere', agentUsed: 'gaa-anywhere-v1', environmentId: 'previous-workspace', lastInteractionId: 'previous-interaction', agentPayloadFingerprint: 'older-payload' });
  await sendTurn(sid, { text: 'Continue our work.' });
  expect(useStore.getState().sessions[sid].migrationContext).toContain('previous-workspace');
  expect(useStore.getState().sessions[sid].environmentId).toBeNull();
  expect(mock.create).toHaveBeenCalledOnce();
  mock.degraded = true;
  await sendTurn(sid, { text: 'Retry after the outage.' });
  expect(mock.create).toHaveBeenCalledOnce();
  expect(useStore.getState().sessions[sid].migrationContext).toContain('previous-workspace');
  expect(useStore.getState().sessions[sid].agentPayloadFingerprint).toBe('older-payload');
});
