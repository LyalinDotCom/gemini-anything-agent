/** A tab owns each turn until completion; reload/crash releases the lock. */
export async function withChatTurnLock(id: string, recovery: boolean, run: () => Promise<void>): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.locks) { await run(); return; }
  await navigator.locks.request(`gaa-turn-${id}`, { ifAvailable: recovery }, async lock => {
    if (lock) await run();
  });
}
