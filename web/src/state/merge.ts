import type { AppState } from "./store";

/** Share the chat index across tabs without sharing each tab's current selection. */
export function mergeChatState(saved: unknown, current: AppState): AppState {
  const remote = (saved ?? {}) as Partial<AppState>;
  const deleted = new Set([...current.deletedSessionIds, ...(remote.deletedSessionIds ?? [])]);
  const sessions = { ...current.sessions, ...remote.sessions };
  const hydrated = { ...current.hydrated };
  for (const [id, local] of Object.entries(current.sessions)) {
    const other = remote.sessions?.[id];
    if (current.streaming[id] || !other || local.updatedAt > other.updatedAt) {
      sessions[id] = local;
    }
    else if (other.updatedAt > local.updatedAt || other.messageCount !== local.messageCount || other.lastInteractionId !== local.lastInteractionId) delete hydrated[id];
    const titleOwner = (other?.titleUpdatedAt ?? 0) > (local.titleUpdatedAt ?? 0) ? other : local;
    if (titleOwner?.titleManuallySet) {
      sessions[id] = { ...sessions[id], title: titleOwner.title, titleManuallySet: true, titleUpdatedAt: titleOwner.titleUpdatedAt };
    }
  }
  const draftText = { ...current.draftText, ...remote.draftText };
  const active = current.activeSessionId;
  if (active && Object.hasOwn(current.draftText, active)) draftText[active] = current.draftText[active];
  for (const id of deleted) { delete sessions[id]; delete draftText[id]; delete hydrated[id]; }
  const sessionOrder = [...new Set([...(remote.sessionOrder ?? []), ...current.sessionOrder, ...Object.keys(sessions)])].filter(id => sessions[id]);
  const selected = active && sessions[active] ? active : remote.activeSessionId && sessions[remote.activeSessionId] ? remote.activeSessionId : sessionOrder[0] ?? null;
  return { ...current, agent: Object.hasOwn(remote, "agent") ? remote.agent! : current.agent, settings: remote.settings ?? current.settings, sessions, hydrated, sessionOrder, draftText, deletedSessionIds: [...deleted], activeSessionId: selected };
}
