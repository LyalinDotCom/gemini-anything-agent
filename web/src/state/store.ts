// Zustand store. Persisted slice (localStorage): settings + session index + agent info —
// KB-scale only. Message bodies live in IndexedDB; the in-memory `messages` map is
// hydrated per session and never persisted. safePersistStorage ports Spark's
// quota-tolerant wrapper (store.ts:11-33).
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AgentInfo } from "../gemini/agents";
import { deleteSessionData, loadTranscript, saveTranscript } from "../storage/messages";
import { uid } from "../utils/id";
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

  createSession(mode?: SessionMode): string;
  deleteSession(id: string): void;
  renameSession(id: string, title: string): void;
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

      createSession(mode: SessionMode = "chat") {
        // Reuse an untouched "New chat" instead of stacking empties.
        const existing = get().sessionOrder.find((sid) => isUntouchedSession(get().sessions[sid]));
        if (existing) {
          set({ activeSessionId: existing });
          void get().hydrateSession(existing);
          return existing;
        }
        const id = uid();
        const now = Date.now();
        const session: Session = {
          id,
          title: "New chat",
          createdAt: now,
          updatedAt: now,
          mode,
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

// Cross-tab convergence: when another tab writes the persisted slice, rehydrate it
// here instead of later clobbering it with this tab's stale copy (last-writer-wins
// on the whole blob was silently discarding sessions created elsewhere).
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === "aichat-store") void useStore.persist.rehydrate();
  });
}
