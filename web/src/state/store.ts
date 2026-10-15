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
import { chatTitle } from "../utils/chatTitle";
import { mergeChatState } from "./merge";
import type { Message, Session, SessionMode } from "./types";

const safePersistStorage = createJSONStorage(() => {
  const volatile = new Map<string, string>();
  return {
    getItem: (key: string) => {
      if (volatile.has(key)) return volatile.get(key)!;
      try { return localStorage.getItem(key); } catch { return null; }
    },
    setItem: (key: string, value: string) => {
      try { localStorage.setItem(key, value); volatile.delete(key); }
      catch { volatile.set(key, value); }
    },
    removeItem: (key: string) => {
      volatile.delete(key);
      try { localStorage.removeItem(key); } catch { /* unavailable storage */ }
    },
  };
});
const hydrationReads = new Map<string, number>();
const unsavedTranscripts = new Map<string, Message[]>();
const transcriptWrites = new Map<string, number>();

export interface Settings {
  sendOnEnter: boolean;
}

/** A draft with no submitted turns. */
export function isUntouchedSession(s: Session | undefined): boolean {
  return !!s && (s.messageCount ?? 0) === 0 && !s.research && !s.pending && !s.lastInteractionId;
}

export interface AppState {
  // persisted
  sessions: Record<string, Session>;
  sessionOrder: string[];
  deletedSessionIds: string[];
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
  persistTranscript(sessionId: string): Promise<void>;

  setAgent(agent: AgentInfo | null): void;
  setStreaming(sessionId: string, on: boolean): void;
  setDraftText(sessionId: string, text: string): void;
  queueRetry(sessionId: string, message: Message | undefined): void;
  updateSettings(patch: Partial<Settings>): void;
}

const transcriptChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("gaa-transcripts") : null;

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      sessions: {},
      sessionOrder: [],
      deletedSessionIds: [],
      activeSessionId: null,
      agent: null,
      settings: { sendOnEnter: true },
      messages: {},
      hydrated: {},
      streaming: {},
      draftText: {},
      retryMessages: {},

      createSession(mode: SessionMode = "chat", agentMode: AgentMode = DEFAULT_AGENT_MODE) {
        // Every explicit New chat action opens a fresh draft, even during a run.
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
        unsavedTranscripts.delete(id); transcriptWrites.delete(id);
        set((s) => {
          const sessions = { ...s.sessions };
          delete sessions[id];
          const messages = { ...s.messages };
          delete messages[id];
          const draftText = { ...s.draftText }; delete draftText[id];
          const hydrated = { ...s.hydrated }; delete hydrated[id];
          const streaming = { ...s.streaming }; delete streaming[id];
          const retryMessages = { ...s.retryMessages }; delete retryMessages[id];
          const order = s.sessionOrder.filter((x) => x !== id);
          return {
            sessions,
            messages,
            draftText, hydrated, streaming, retryMessages,
            deletedSessionIds: [...new Set([...s.deletedSessionIds, id])],
            sessionOrder: order,
            activeSessionId: s.activeSessionId === id ? (order[0] ?? null) : s.activeSessionId,
          };
        });
        void deleteSessionData(id);
      },

      renameSession(id, title) {
        get().patchSession(id, { title, titleManuallySet: true, titleUpdatedAt: Date.now() });
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
        if (id && !get().sessions[id]) return;
        set({ activeSessionId: id });
        if (id) void get().hydrateSession(id).catch(() => undefined);
      },

      patchSession(id, patch) {
        set((s) => {
          const existing = s.sessions[id];
          if (!existing) return s;
          return { sessions: { ...s.sessions, [id]: { ...existing, ...patch, updatedAt: Date.now() } } };
        });
      },

      async hydrateSession(id) {
        if (get().hydrated[id] || !get().sessions[id]) return;
        const generation = (hydrationReads.get(id) ?? 0) + 1;
        hydrationReads.set(id, generation);
        const loaded = unsavedTranscripts.get(id) ?? await loadTranscript(id);
        set((s) => {
          if (s.hydrated[id] || !s.sessions[id] || hydrationReads.get(id) !== generation) return s;
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
              ? { ...s.sessions, [sessionId]: { ...session,
                title: message.role === "user" && session.title === "New chat" && !session.titleManuallySet ? chatTitle(message) : session.title,
                updatedAt: Date.now(), messageCount: (session.messageCount ?? 0) + 1 } }
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

      async persistTranscript(sessionId) {
        if (!get().sessions[sessionId] || get().deletedSessionIds.includes(sessionId)) return;
        // Never write an un-hydrated (partial) view over the stored transcript.
        if (!get().hydrated[sessionId]) return;
        const list = get().messages[sessionId];
        if (!list) return;
        const version = (transcriptWrites.get(sessionId) ?? 0) + 1;
        transcriptWrites.set(sessionId, version);
        try {
          await saveTranscript(sessionId, list);
          if (transcriptWrites.get(sessionId) === version) {
            unsavedTranscripts.delete(sessionId);
            if (get().sessions[sessionId]?.historySaveError) get().patchSession(sessionId, { historySaveError: false });
          }
          transcriptChannel?.postMessage({ sessionId });
        } catch {
          if (get().sessions[sessionId] && transcriptWrites.get(sessionId) === version) {
            unsavedTranscripts.set(sessionId, get().messages[sessionId] ?? list);
            get().patchSession(sessionId, { historySaveError: true });
          }
        }
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
      name: "gaa-store",
      // Green-field policy: no migrations, ever. Bumping the version discards any
      // previously persisted state (zustand drops mismatched versions).
      version: 1,
      storage: safePersistStorage,
      merge: mergeChatState,
      partialize: (s) => ({
        sessions: s.sessions,
        sessionOrder: s.sessionOrder,
        deletedSessionIds: s.deletedSessionIds,
        activeSessionId: s.activeSessionId,
        agent: s.agent,
        settings: s.settings,
        draftText: s.draftText,
      }),
    },
  ),
);

// Cross-tab convergence: when another tab writes the persisted slice, rehydrate it
// here instead of later clobbering it with this tab's stale copy (last-writer-wins
// on the whole blob was silently discarding sessions created elsewhere).
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === "gaa-store") {
      void Promise.resolve(useStore.persist.rehydrate()).then(() => {
        const id = useStore.getState().activeSessionId;
        if (id) void useStore.getState().hydrateSession(id).catch(() => undefined);
      });
    }
  });
}

// Publish only after IndexedDB commits; localStorage metadata may arrive earlier.
if (transcriptChannel) transcriptChannel.onmessage = (event: MessageEvent<{ sessionId: string }>) => {
  const id = event.data?.sessionId;
  const state = useStore.getState();
  if (!id || !state.sessions[id] || state.streaming[id]) return;
  useStore.setState(s => ({ hydrated: { ...s.hydrated, [id]: false } }));
  if (state.activeSessionId === id) void state.hydrateSession(id).catch(() => undefined);
};
