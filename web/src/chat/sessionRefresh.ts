import { useStore } from "../state/store";
import { recoverPendingTurn } from "./controller";
import { resumeResearchIfNeeded } from "../gemini/deepResearch";
import { wakeStoredRun } from "../gemini/storedRunWake";

let refreshing: Promise<void> | undefined;

export function resumeStoredSession(id: string): Promise<void> {
  // Each recovery takes the same nonblocking Web Lock. Starting both races:
  // the irrelevant research check can win and prevent ordinary turn recovery.
  return useStore.getState().sessions[id]?.research
    ? resumeResearchIfNeeded(id)
    : recoverPendingTurn(id);
}

export function refreshActiveSession(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    await useStore.persist.rehydrate();
    const state = useStore.getState();
    for (const [sessionId, running] of Object.entries(state.streaming)) if (running) wakeStoredRun(sessionId);
    const id = state.activeSessionId;
    if (!id || !state.sessions[id]) return;
    if (state.streaming[id]) {
      return;
    }
    // A suspended tab can miss both storage and BroadcastChannel events.
    await state.hydrateSession(id, true);
    if (useStore.getState().activeSessionId !== id) return;
    void resumeStoredSession(id).catch(() => undefined);
  })().finally(() => { refreshing = undefined; });
  return refreshing;
}

export function listenForAppReturn(refresh: () => Promise<void>, win: EventTarget, doc: EventTarget & { visibilityState: string }): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const returned = () => {
    if (doc.visibilityState !== "visible") return;
    clearTimeout(timer);
    timer = setTimeout(() => { void refresh().catch(() => undefined); }, 150);
  };
  doc.addEventListener("visibilitychange", returned);
  doc.addEventListener("resume", returned);
  for (const name of ["focus", "pageshow", "online"]) win.addEventListener(name, returned);
  return () => {
    clearTimeout(timer);
    doc.removeEventListener("visibilitychange", returned);
    doc.removeEventListener("resume", returned);
    for (const name of ["focus", "pageshow", "online"]) win.removeEventListener(name, returned);
  };
}
