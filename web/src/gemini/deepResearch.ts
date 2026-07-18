// Deep Research sessions: background interactions that outlive the tab.
//   start → interaction id persisted on the session → watch via streaming reattach
//   (interactions.get(id, {stream:true, last_event_id})) with a 10s poll fallback
//   (gaicli run.ts pattern) → terminal interaction rendered like any other turn.
// Survives reloads: resumeResearchIfNeeded re-adopts the placeholder message.
import { blocksToParts, settleParts, type MediaStampedBlock } from "../chat/blocksToParts";
import { profileForSession } from "../agentProfiles";
import { effectiveRunOptions } from "../state/runOptions";
import { useStore } from "../state/store";
import type { ContentPart, Message } from "../state/types";
import { uid } from "../utils/id";
import { ai } from "./client";
import { toFriendly } from "./errors";
import { buildInteractionParams } from "./interactionParams";
import {
  asEventStream,
  blocksFromInteraction,
  consumeInteractionStream,
  type StreamOutcome,
} from "./streamAdapter";

const POLL_INTERVAL_MS = 10_000;
const TERMINAL = new Set(["completed", "failed", "cancelled", "incomplete", "budget_exceeded"]);

const watching = new Set<string>();

function statusPart(label: string): ContentPart {
  return { kind: "tool", id: "research-status", activity: { tool: "other", label, status: "running" } };
}

function renderOutcome(sessionId: string, messageId: string, outcome: StreamOutcome, done: boolean): void {
  const parts = blocksToParts(outcome.blocks as MediaStampedBlock[], "dr");
  const status = outcome.status || "in_progress";
  const display = done ? settleParts(parts, status !== "completed") : [statusPart(researchLabel(status)), ...parts];
  useStore.getState().patchMessage(sessionId, messageId, {
    parts: display,
    status: done ? (status === "completed" ? "complete" : "error") : "streaming",
    errorMessage: done && status !== "completed" ? `Research ended: ${status}.` : undefined,
    interactionId: outcome.interactionId || undefined,
    usage: outcome.usage,
    completedAt: done ? Date.now() : undefined,
  });
}

function researchLabel(status: string): string {
  if (status === "requires_action") return "Research needs input (unsupported) …";
  return status === "in_progress" ? "Researching… this can take several minutes" : `Research: ${status}`;
}

async function pollOnce(interactionId: string): Promise<StreamOutcome> {
  const interaction = (await ai().interactions.get(interactionId)) as Record<string, unknown>;
  return blocksFromInteraction(interaction);
}

async function watch(sessionId: string, messageId: string, interactionId: string): Promise<void> {
  if (watching.has(interactionId)) return;
  watching.add(interactionId);
  const store = () => useStore.getState();
  let lastEventId: string | undefined = store().sessions[sessionId]?.research?.lastEventId;

  try {
    for (;;) {
      // Preferred: live reattach stream (thinking summaries render as they happen).
      try {
        const stream = await ai().interactions.get(interactionId, {
          stream: true,
          last_event_id: lastEventId,
        } as never);
        const outcome = await consumeInteractionStream(asEventStream(stream), (blocks, meta) => {
          lastEventId = meta.lastEventId ?? lastEventId;
          renderOutcome(
            sessionId,
            messageId,
            { ...meta, interactionId: meta.interactionId || interactionId, blocks: [...blocks] },
            false,
          );
        });
        if (outcome.lastEventId) lastEventId = outcome.lastEventId;
        store().patchSession(sessionId, {
          research: { interactionId, startedAt: store().sessions[sessionId]?.research?.startedAt ?? Date.now(), lastEventId },
        });
        if (TERMINAL.has(outcome.status)) {
          const full = await pollOnce(interactionId); // final resource has complete steps
          finish(sessionId, messageId, full);
          return;
        }
      } catch (e) {
        if (toFriendly(e).kind === "bad-key") throw e;
        // Stream reattach unavailable — fall through to polling.
      }

      // Fallback: poll until terminal or until a fresh reattach succeeds.
      const outcome = await pollOnce(interactionId);
      if (TERMINAL.has(outcome.status)) {
        finish(sessionId, messageId, outcome);
        return;
      }
      renderOutcome(sessionId, messageId, outcome, false);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  } catch (e) {
    useStore.getState().patchMessage(sessionId, messageId, {
      status: "error",
      errorMessage: toFriendly(e).message,
      completedAt: Date.now(),
    });
    useStore.getState().patchSession(sessionId, { research: null });
    useStore.getState().setStreaming(sessionId, false);
    useStore.getState().persistTranscript(sessionId);
  } finally {
    watching.delete(interactionId);
  }
}

function finish(sessionId: string, messageId: string, outcome: StreamOutcome): void {
  renderOutcome(sessionId, messageId, outcome, true);
  useStore.getState().patchSession(sessionId, {
    research: null,
    lastInteractionId: outcome.interactionId || null,
    environmentId: outcome.environmentId || null,
  });
  useStore.getState().setStreaming(sessionId, false);
  useStore.getState().persistTranscript(sessionId);
}

/** Start a research turn (also used for follow-ups: chains via previous ids). */
export async function sendResearchTurn(sessionId: string, text: string): Promise<void> {
  await useStore.getState().hydrateSession(sessionId); // never append onto an un-hydrated transcript
  const store = useStore.getState();
  if (store.streaming[sessionId] || !text.trim()) return;
  const session = store.sessions[sessionId];
  if (!session) return;

  const userMessage: Message = {
    id: uid(),
    role: "user",
    createdAt: Date.now(),
    status: "complete",
    parts: [{ kind: "text", id: uid(), text: text.trim() }],
  };
  store.appendMessage(sessionId, userMessage);

  const assistantId = uid();
  store.appendMessage(sessionId, {
    id: assistantId,
    role: "assistant",
    createdAt: Date.now(),
    status: "streaming",
    parts: [statusPart("Starting deep research…")],
  });
  store.setStreaming(sessionId, true);
  store.persistTranscript(sessionId);

  try {
    const profile = profileForSession(session);
    const params = buildInteractionParams({
      agent: profile.agentId,
      input: text.trim(),
      previousInteractionId: session.lastInteractionId ?? undefined,
      environmentId: session.environmentId ?? undefined,
      deepResearch: true,
      thinkingSummaries: effectiveRunOptions(session).thinkingSummaries,
      stream: false,
    });
    // retries "none": an auto-retried POST would start a duplicate research run.
    const created = (await ai().interactions.create(params as never, {
      retries: { strategy: "none" },
    } as never)) as Record<string, unknown>;
    const interactionId = String(created.id ?? "");
    if (!interactionId) throw new Error("Research start returned no interaction id");

    useStore.getState().patchSession(sessionId, {
      research: { interactionId, startedAt: Date.now() },
    });
    useStore.getState().persistTranscript(sessionId);
    await watch(sessionId, assistantId, interactionId);
  } catch (e) {
    useStore.getState().patchMessage(sessionId, assistantId, {
      status: "error",
      errorMessage: toFriendly(e).message,
      parts: [],
      completedAt: Date.now(),
    });
    useStore.getState().patchSession(sessionId, { research: null });
    useStore.getState().setStreaming(sessionId, false);
    useStore.getState().persistTranscript(sessionId);
  }
}

/** After a reload: re-adopt an in-flight research run (called when a session mounts). */
export function resumeResearchIfNeeded(sessionId: string): void {
  const store = useStore.getState();
  const session = store.sessions[sessionId];
  const research = session?.research;
  if (!research || watching.has(research.interactionId)) return;

  const messages = store.messages[sessionId] ?? [];
  let placeholder = [...messages].reverse().find((m) => m.role === "assistant" && m.status === "streaming");
  if (!placeholder) {
    placeholder = {
      id: uid(),
      role: "assistant",
      createdAt: Date.now(),
      status: "streaming",
      parts: [statusPart("Reattaching to research…")],
    };
    store.appendMessage(sessionId, placeholder);
  }
  store.setStreaming(sessionId, true);
  void watch(sessionId, placeholder.id, research.interactionId);
}
