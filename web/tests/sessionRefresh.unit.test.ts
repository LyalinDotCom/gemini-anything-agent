import { beforeEach, afterEach, expect, test, vi } from 'vitest';
const readGate = vi.hoisted(() => ({ wait: undefined as Promise<void> | undefined }));
const saved = vi.hoisted(() => new Map<string, unknown[]>());
const mocks = vi.hoisted(() => ({ recover: vi.fn(async () => {}), research: vi.fn(async () => {}), wake: vi.fn() }));
vi.mock('../src/chat/controller', () => ({ recoverPendingTurn: mocks.recover }));
vi.mock('../src/gemini/deepResearch', () => ({ resumeResearchIfNeeded: mocks.research }));
vi.mock('../src/gemini/storedRunWake', () => ({ wakeStoredRun: mocks.wake }));
vi.mock('../src/storage/messages', () => ({ loadTranscript: async (id:string) => { const list = saved.get(id) ?? []; await readGate.wait; return list; }, saveTranscript: async () => {}, deleteSessionData: async () => {} }));
import { useStore } from '../src/state/store';
import { listenForAppReturn, refreshActiveSession } from '../src/chat/sessionRefresh';

beforeEach(() => {
  vi.clearAllMocks(); saved.clear(); readGate.wait = undefined; localStorage.clear();
  useStore.setState({ sessions: {}, sessionOrder: [], deletedSessionIds: [], activeSessionId: null, messages: {}, hydrated: {}, streaming: {}, draftText: {} });
});
afterEach(() => vi.useRealTimers());

test('return coalesces focus, visible, pageshow and reconnect events and ignores background events', async () => {
  vi.useFakeTimers(); const win = new EventTarget(); const doc = Object.assign(new EventTarget(), { visibilityState: 'hidden' }); const refresh = vi.fn(async () => {});
  const remove = listenForAppReturn(refresh, win, doc);
  win.dispatchEvent(new Event('focus')); doc.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(200); expect(refresh).not.toHaveBeenCalled();
  doc.visibilityState = 'visible';
  for (const type of ['focus', 'pageshow', 'online']) win.dispatchEvent(new Event(type));
  doc.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(150); expect(refresh).toHaveBeenCalledTimes(1);
  remove(); win.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(200); expect(refresh).toHaveBeenCalledTimes(1);
});

test('return refreshes a cached transcript and recovers the stored run without replacing the draft', async () => {
  const id = useStore.getState().createSession();
  useStore.setState({ hydrated: { [id]: true } });
  useStore.getState().setDraftText(id, 'Unsent draft');
  useStore.getState().patchSession(id, { pending: { interactionId: 'existing-run', messageId: 'answer', startedAt: 1 } });
  saved.set(id, [{ id: 'answer', role: 'assistant', status: 'complete', createdAt: 1, parts: [{ kind: 'text', id: 'text', text: 'Finished while away' }] }]);
  await Promise.all([refreshActiveSession(), refreshActiveSession()]);
  expect(useStore.getState().messages[id][0].status).toBe('complete');
  expect(useStore.getState().draftText[id]).toBe('Unsent draft');
  expect(mocks.recover).toHaveBeenCalledExactlyOnceWith(id);
});

test('an existing local owner is woken without starting another recovery or overwriting its live message', async () => {
  const id = useStore.getState().createSession();
  useStore.getState().appendMessage(id, { id: 'live', role: 'assistant', createdAt: 1, status: 'streaming', parts: [] });
  useStore.getState().setStreaming(id, true);
  await refreshActiveSession();
  expect(mocks.wake).toHaveBeenCalledExactlyOnceWith(id); expect(mocks.recover).not.toHaveBeenCalled();
  expect(useStore.getState().messages[id][0].id).toBe('live');
});

test('refresh cannot overwrite a message patched during an IndexedDB read', async () => {
  const id = useStore.getState().createSession();
  const message = { id: 'answer', role: 'assistant' as const, status: 'complete' as const, createdAt: 1, parts: [] };
  useStore.getState().appendMessage(id, message); saved.set(id, [message]);
  let release!: () => void; readGate.wait = new Promise(resolve => { release = resolve; });
  const refresh = useStore.getState().hydrateSession(id, true);
  useStore.getState().patchMessage(id, 'answer', { errorMessage: 'Concurrent local update' });
  release(); await refresh;
  expect(useStore.getState().messages[id][0].errorMessage).toBe('Concurrent local update');
  expect(useStore.getState().hydrated[id]).toBe(true);
});

test('forced transcript refresh honours a saved truncation from another tab', async () => {
  const id = useStore.getState().createSession();
  const first = { id: 'first', role: 'user' as const, status: 'complete' as const, createdAt: 1, parts: [] };
  useStore.getState().appendMessage(id, first);
  useStore.getState().appendMessage(id, { ...first, id: 'removed' });
  saved.set(id, [first]); await useStore.getState().hydrateSession(id, true);
  expect(useStore.getState().messages[id].map(message => message.id)).toEqual(['first']);
});

test('overlapping forced reads share the baseline and cannot revert a concurrent patch', async () => {
  const id = useStore.getState().createSession();
  const message = { id: 'answer', role: 'assistant' as const, status: 'complete' as const, createdAt: 1, parts: [] };
  useStore.getState().appendMessage(id, message); saved.set(id, [message]);
  let release!: () => void; readGate.wait = new Promise(resolve => { release = resolve; });
  const first = useStore.getState().hydrateSession(id, true);
  useStore.getState().patchMessage(id, 'answer', { errorMessage: 'Concurrent patch' });
  const second = useStore.getState().hydrateSession(id, true);
  release(); await Promise.all([first, second]);
  expect(useStore.getState().messages[id][0].errorMessage).toBe('Concurrent patch');
});

test('normal recovery does not race the research checker for the same Web Lock', async () => {
  const id = useStore.getState().createSession();
  useStore.getState().patchSession(id, { pending: { interactionId: 'stored', messageId: 'answer', startedAt: 1 } });
  await refreshActiveSession();
  expect(mocks.recover).toHaveBeenCalledExactlyOnceWith(id);
  expect(mocks.research).not.toHaveBeenCalled();
});

test('research recovery takes only its own path instead of competing with ordinary recovery', async () => {
  const id = useStore.getState().createSession('deep-research');
  useStore.getState().patchSession(id, { research: { interactionId: 'research', startedAt: 1 } });
  await refreshActiveSession();
  expect(mocks.research).toHaveBeenCalledExactlyOnceWith(id);
  expect(mocks.recover).not.toHaveBeenCalled();
});
