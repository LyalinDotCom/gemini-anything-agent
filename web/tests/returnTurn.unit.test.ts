import { expect, test, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn(), cancel: vi.fn() }));
vi.mock('../src/gemini/client', () => ({ ai: () => ({ interactions: sdk }), resolveApiKey: () => 'fixture-key' }));
vi.mock('../src/gemini/agents', () => ({ agentWorkflowFingerprint: () => 'fixture-payload', ensureManagedAgent: vi.fn() }));
vi.mock('../src/storage/messages', () => ({ loadTranscript: async () => [], saveTranscript: async () => {}, putMedia: vi.fn(), mediaId: () => '' }));
import { useStore } from '../src/state/store';
import { sendTurn } from '../src/chat/controller';
import { wakeStoredRun } from '../src/gemini/storedRunWake';

test('return wakes an acknowledged stale stream, polls its same ID and never repeats generation or cancellation', async () => {
  const id = useStore.getState().createSession();
  sdk.create.mockImplementation(async (_params, options) => (async function* () {
    yield { event_type: 'interaction.created', interaction: { id: 'stored-run', status: 'in_progress' } };
    await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  })());
  sdk.get.mockResolvedValue({ id: 'stored-run', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Recovered answer' }] }] });
  const turn = sendTurn(id, { text: 'Keep this one run' });
  await vi.waitFor(() => expect(useStore.getState().sessions[id].pending?.interactionId).toBe('stored-run'));
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16_000);
  try { wakeStoredRun(id); await turn; } finally { now.mockRestore(); }
  expect(sdk.create).toHaveBeenCalledTimes(1); expect(sdk.cancel).not.toHaveBeenCalled();
  expect(sdk.get.mock.calls[0][0]).toBe('stored-run');
  expect(useStore.getState().sessions[id].pending).toBeNull();
  expect(useStore.getState().streaming[id]).toBe(false);
  expect(useStore.getState().messages[id].at(-1)?.status).toBe('complete');
});
