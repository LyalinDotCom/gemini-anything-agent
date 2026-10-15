// Waking a tab interrupts only its transport/wait, never the remote interaction.
// The existing owner then polls the same stored ID and keeps its chat lock.
const wakeups = new Map<string, () => void>();

export function wakeStoredRun(sessionId: string): void {
  wakeups.get(sessionId)?.();
}

export class StoredRunWakeError extends Error {}

export async function withStoredStream<T>(
  sessionId: string,
  owner: AbortSignal,
  acknowledged: () => boolean,
  read: (signal: AbortSignal, touch: () => void) => Promise<T>,
  staleAfterMs = 15_000,
): Promise<T> {
  const transport = new AbortController();
  const abort = () => transport.abort();
  let lastEvent = Date.now();
  let woken = false;
  const touch = () => { lastEvent = Date.now(); };
  const wake = () => {
    if (acknowledged() && Date.now() - lastEvent >= staleAfterMs) { woken = true; abort(); }
  };
  owner.addEventListener("abort", abort, { once: true });
  if (owner.aborted) abort();
  wakeups.set(sessionId, wake);
  try { return await read(transport.signal, touch); }
  catch (error) {
    if (woken && !owner.aborted) throw new StoredRunWakeError("Checking the stored run after returning");
    throw error;
  }
  finally {
    if (wakeups.get(sessionId) === wake) wakeups.delete(sessionId);
    owner.removeEventListener("abort", abort);
    abort();
  }
}

export function waitForStoredPoll(sessionId: string, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      if (wakeups.get(sessionId) === finish) wakeups.delete(sessionId);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    wakeups.set(sessionId, finish);
    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted) finish();
  });
}
