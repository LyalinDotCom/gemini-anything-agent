// Zustand store. Persisted slice (localStorage): settings + session index + agent info —
// KB-scale only. Message bodies live in IndexedDB; the in-memory `messages` map is
// hydrated per session and never persisted. safePersistStorage ports Spark's
// quota-tolerant wrapper (store.ts:11-33).
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AgentInfo } from "../gemini/agents";
import { DEFAULT_AGENT_MODE, type AgentMode } from "../agentProfiles";
import { deleteSessionData, loadTranscript, saveTranscript } from "../storage/messages";
import { uid } from "../utils/id";
import { CHAT_AGENT_ID, BROWSER_AGENT_ID } from "../models";
import type { Message, Session, SessionMode } from "./types";

const safePersistStorage = createJSONStorage(() => {
  try {
    localStorage.getItem("__probe__");
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
  }
});

export interface Settings {
  sendOnEnter: boolean;
}

/** A session nobody has used yet — reused by "New chat", not deletable, not precious.
 *  Based on messageCount (persisted), so a streaming or errored chat never counts as
 *  untouched (title/ids only settle at turn end and would misclassify it). */
export function isUntouchedSession(s: Session | undefined): boolean {
  return !!s && (s.messageCount ?? 0) === 0 && !s.research && !s.pending && !s.lastInteractionId;
}

interface AppState {
  // persisted
  sessions: Record<string, Session>;
  sessionOrder: string[];
  activeSessionId: string | null;
  agent: AgentInfo | null;
  settings: Settings;
  // ephemeral
  messages: Record<string, Message[]>;
  hydrated: Record<string, boolean>;
  /** Per-session in-flight turns — sessions stream CONCURRENTLY and independently. */
  streaming: Record<string, boolean>;
  /** Per-session composer drafts, so switching chats never bleeds or loses text. */
  draftText: Record<string, string>;
  retryMessages: Record<string, Message | undefined>;

  createSession(mode?: SessionMode, agentMode?: AgentMode): string;
  deleteSession(id: string): void;
  renameSession(id: string, title: string): void;
  /** Move a session before `beforeId`, or to the end of the list when null. */
  reorderSession(id: string, beforeId: string | null): void;
  setActiveSession(id: string | null): void;
  patchSession(id: string, patch: Partial<Session>): void;

  hydrateSession(id: string): Promise<void>;
  setMessages(sessionId: string, messages: Message[]): void;
  appendMessage(sessionId: string, message: Message): void;
  patchMessage(sessionId: string, messageId: string, patch: Partial<Message>): void;
  persistTranscript(sessionId: string): void;

  setAgent(agent: AgentInfo | null): void;
  setStreaming(sessionId: string, on: boolean): void;
  setDraftText(sessionId: string, text: string): void;
  queueRetry(sessionId: string, message: Message | undefined): void;
  updateSettings(patch: Partial<Settings>): void;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      sessions: {},
      sessionOrder: [],
      activeSessionId: null,
      agent: null,
      settings: { sendOnEnter: true },
      messages: {},
      hydrated: {},
      streaming: {},
      draftText: {},
      retryMessages: {},

      createSession(mode: SessionMode = "chat", agentMode: AgentMode = DEFAULT_AGENT_MODE) {
        // Reuse an untouched "New chat" instead of stacking empties.
        const existing = get().sessionOrder.find((sid) => isUntouchedSession(get().sessions[sid]));
        if (existing) {
          set({ activeSessionId: existing });
          void get().hydrateSession(existing);
          return existing;
        }
        const id = uid();
        const now = Date.now();
        // No runOptions seed: readers default via effectiveRunOptions, so default
        // changes reach existing sessions instead of freezing at creation time.
        const session: Session = {
          id,
          title: "New chat",
          createdAt: now,
          updatedAt: now,
          mode,
          agentMode,
          lastInteractionId: null,
          environmentId: null,
          messageCount: 0,
        };
        set((s) => ({
          sessions: { ...s.sessions, [id]: session },
          sessionOrder: [id, ...s.sessionOrder],
          activeSessionId: id,
          messages: { ...s.messages, [id]: [] },
          hydrated: { ...s.hydrated, [id]: true },
        }));
        return id;
      },

      deleteSession(id) {
        set((s) => {
          const sessions = { ...s.sessions };
          delete sessions[id];
          const messages = { ...s.messages };
          delete messages[id];
          const order = s.sessionOrder.filter((x) => x !== id);
          return {
            sessions,
            messages,
            sessionOrder: order,
            activeSessionId: s.activeSessionId === id ? (order[0] ?? null) : s.activeSessionId,
          };
        });
        void deleteSessionData(id);
      },

      renameSession(id, title) {
        get().patchSession(id, { title });
      },

      reorderSession(id, beforeId) {
        if (id === beforeId) return;
        set((s) => {
          const next = s.sessionOrder.filter((item) => item !== id);
          const index = beforeId === null ? -1 : next.indexOf(beforeId);
          next.splice(index < 0 ? next.length : index, 0, id);
          return { sessionOrder: next };
        });
      },

      setActiveSession(id) {
        set({ activeSessionId: id });
        if (id) void get().hydrateSession(id);
      },

      patchSession(id, patch) {
        set((s) => {
          const existing = s.sessions[id];
          if (!existing) return s;
          return { sessions: { ...s.sessions, [id]: { ...existing, ...patch, updatedAt: Date.now() } } };
        });
      },

      async hydrateSession(id) {
        if (get().hydrated[id]) return;
        const loaded = await loadTranscript(id);
        set((s) => {
          if (s.hydrated[id]) return s;
          // MERGE with anything appended while the IDB read was in flight — never
          // clobber live messages with the loaded snapshot.
          const inFlight = s.messages[id] ?? [];
          const loadedIds = new Set(loaded.map((m) => m.id));
          return {
            messages: { ...s.messages, [id]: [...loaded, ...inFlight.filter((m) => !loadedIds.has(m.id))] },
            hydrated: { ...s.hydrated, [id]: true },
          };
        });
      },

      setMessages(sessionId, list) {
        set((s) => ({ messages: { ...s.messages, [sessionId]: list } }));
      },

      appendMessage(sessionId, message) {
        set((s) => {
          const session = s.sessions[sessionId];
          return {
            messages: { ...s.messages, [sessionId]: [...(s.messages[sessionId] ?? []), message] },
            sessions: session
              ? { ...s.sessions, [sessionId]: { ...session, messageCount: (session.messageCount ?? 0) + 1 } }
              : s.sessions,
          };
        });
      },

      patchMessage(sessionId, messageId, patch) {
        set((s) => {
          const list = s.messages[sessionId];
          if (!list) return s;
          return {
            messages: {
              ...s.messages,
              [sessionId]: list.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
            },
          };
        });
      },

      persistTranscript(sessionId) {
        // Never write an un-hydrated (partial) view over the stored transcript.
        if (!get().hydrated[sessionId]) return;
        const list = get().messages[sessionId];
        if (list) void saveTranscript(sessionId, list);
      },

      setAgent(agent) {
        set({ agent });
      },

      setStreaming(sessionId, on) {
        set((s) => ({ streaming: { ...s.streaming, [sessionId]: on } }));
      },

      setDraftText(sessionId, text) {
        set((s) => ({ draftText: { ...s.draftText, [sessionId]: text } }));
      },

      queueRetry(sessionId, message) {
        set((s) => ({ retryMessages: { ...s.retryMessages, [sessionId]: message } }));
      },

      updateSettings(patch) {
        set((s) => ({ settings: { ...s.settings, ...patch } }));
      },
    }),
    {
      name: "aichat-store",
      // Green-field policy: no migrations, ever. Bumping the version discards any
      // previously persisted state (zustand drops mismatched versions).
      version: 3,
      storage: safePersistStorage,
      partialize: (s) => ({
        sessions: s.sessions,
        sessionOrder: s.sessionOrder,
        activeSessionId: s.activeSessionId,
        agent: s.agent,
        settings: s.settings,
      }),
    },
  ),
);

// Sessions saved by builds before the agent rename (agentUsed "gemini-anything-v1")
// predate agentMode and pin an agent id that can no longer be recreated (reserved
// prefix). Remap them to the current managed profile and mark the chain broken —
// the old interactions belong to a different agent id, so the next turn rebuilds
// context through the existing recap machinery. Idempotent; runs after every
// rehydrate. The persisted agent record gets the same treatment: a stale id must
// never reach Settings' verify/recreate/delete actions.
const LEGACY_CHAT_AGENT_IDS = new Set(["gemini-anything-v1"]);
export function normalizeLegacySessions(): void {
  const state = useStore.getState();
  const remapped: Record<string, Session> = {};
  for (const [id, session] of Object.entries(state.sessions)) {
    if (!session.agentUsed || !LEGACY_CHAT_AGENT_IDS.has(session.agentUsed)) continue;
    remapped[id] = {
      ...session,
      agentUsed: CHAT_AGENT_ID,
      agentMode: session.agentMode ?? "anything",
      chainBroken: Boolean(session.lastInteractionId || session.environmentId) || session.chainBroken,
      lastInteractionId: null,
      environmentId: null,
      pending: null,
    };
  }
  const agent = state.agent;
  const staleAgentRecord = Boolean(
    agent && agent.agentId && agent.agentId !== CHAT_AGENT_ID && agent.agentId !== BROWSER_AGENT_ID,
  );
  if (Object.keys(remapped).length > 0 || staleAgentRecord) {
    useStore.setState((s) => ({
      sessions: { ...s.sessions, ...remapped },
      agent: staleAgentRecord ? null : s.agent,
    }));
  }
}
normalizeLegacySessions();

// Cross-tab convergence: when another tab writes the persisted slice, rehydrate it
// here instead of later clobbering it with this tab's stale copy (last-writer-wins
// on the whole blob was silently discarding sessions created elsewhere).
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === "aichat-store") {
      void Promise.resolve(useStore.persist.rehydrate()).then(normalizeLegacySessions);
    }
  });
}
