import { expect, test, vi } from 'vitest';
import { waitForStoredPoll, wakeStoredRun, withStoredStream } from '../src/gemini/storedRunWake';

test('return interrupts an acknowledged transport but preserves the owner and stored run', async () => {
  const owner = new AbortController(); let acknowledged = false; let transport!: AbortSignal;
  const run = withStoredStream('chat', owner.signal, () => acknowledged, signal => new Promise<void>(resolve => { transport = signal; signal.addEventListener('abort', () => resolve()); }), 0);
  wakeStoredRun('chat'); expect(transport.aborted).toBe(false);
  acknowledged = true; wakeStoredRun('chat'); await run;
  expect(transport.aborted).toBe(true); expect(owner.signal.aborted).toBe(false);
  wakeStoredRun('chat'); // cleanup leaves no transport behind
});

test('return wakes polling immediately and owner abort also releases its wait', async () => {
  const owner = new AbortController(); const first = waitForStoredPoll('poll', 60_000, owner.signal);
  wakeStoredRun('poll'); await first;
  expect(owner.signal.aborted).toBe(false);
  const second = waitForStoredPoll('poll', 60_000, owner.signal); owner.abort(); await second;
});

test('ordinary focus leaves a healthy stream attached, but a stale stream can be refreshed', async () => {
  vi.useFakeTimers();
  try {
    const owner = new AbortController(); let transport!: AbortSignal; let touch!: () => void;
    const run = withStoredStream('healthy', owner.signal, () => true, (signal, event) => new Promise<void>(resolve => { transport = signal; touch = event; signal.addEventListener('abort', () => resolve()); }));
    await vi.advanceTimersByTimeAsync(14_000); wakeStoredRun('healthy'); expect(transport.aborted).toBe(false);
    touch(); await vi.advanceTimersByTimeAsync(14_000); wakeStoredRun('healthy'); expect(transport.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000); wakeStoredRun('healthy'); await run;
    expect(transport.aborted).toBe(true); expect(owner.signal.aborted).toBe(false);
  } finally { vi.useRealTimers(); }
});
