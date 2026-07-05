import {
  ANTIGRAVITY_BASE_AGENT,
  extractInteractionOutputText,
  isDeepResearchAgentId,
  type BaseAgentId,
  type Interaction,
  type InteractionStreamEvent,
  type ManagedAgent
} from "@sdk";
import type { InteractionStreamSnapshot } from "../../shared/electron-api";
import type { Session } from "./builderState";
import { buildTimeline, type TimelineItem } from "./timeline";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const timelineItemsForSession = (session: Session): TimelineItem[] => {
  const items = buildTimeline(session.seed, session.events);
  if (!session.error) {
    return items;
  }
  return [
    ...items,
    {
      id: "error",
      kind: "error",
      title: session.error.name,
      body: session.error.message,
      summary: session.error.message,
      status: "error"
    }
  ];
};

export const patchSeedFromStreamEvent = (
  seed: Interaction | undefined,
  event: InteractionStreamEvent
): Interaction | undefined => {
  if (event.interaction) {
    return { ...(seed ?? {}), ...event.interaction };
  }
  if (event.interaction_id || event.status) {
    const id = event.interaction_id ?? seed?.id;
    if (id) {
      return {
        ...(seed ?? { id }),
        id,
        status: event.status ?? seed?.status
      };
    }
  }
  if (event.event_type === "step.start" && isRecord(event.step)) {
    const id = seed?.id;
    if (id) {
      return {
        ...seed,
        id,
        steps: [...(Array.isArray(seed.steps) ? seed.steps : []), event.step]
      };
    }
  }
  return seed;
};

export const patchSeedFromStreamSnapshot = (
  seed: Interaction | undefined,
  snapshot: InteractionStreamSnapshot
): Interaction | undefined => {
  const fromEvents = snapshot.events.reduce<Interaction | undefined>(
    (current, event) => patchSeedFromStreamEvent(current, event),
    seed
  );
  if (snapshot.latestInteraction) {
    return { ...(fromEvents ?? {}), ...snapshot.latestInteraction };
  }
  return fromEvents;
};

const NON_TERMINAL_INTERACTION_STATUS = new Set([
  "queued",
  "running",
  "in_progress",
  "in-progress",
  "pending",
  "processing",
  "started",
  // Documented state between in_progress and completed: the interaction is
  // waiting for client input (e.g. Deep Research collaborative planning) and
  // must keep being followed, not shown as succeeded.
  "requires_action",
  "requires-action"
]);

const FAILED_INTERACTION_STATUS = new Set(["failed", "error", "cancelled", "canceled", "expired"]);

export const interactionIsTerminal = (interaction: Interaction): boolean => {
  const status = interaction.status?.toLowerCase();
  if (status) {
    return !NON_TERMINAL_INTERACTION_STATUS.has(status);
  }
  return Boolean(extractInteractionOutputText(interaction));
};

export const interactionIsSuccessfulTerminal = (interaction: Interaction): boolean => {
  const status = interaction.status?.toLowerCase();
  if (status) {
    return !NON_TERMINAL_INTERACTION_STATUS.has(status) && !FAILED_INTERACTION_STATUS.has(status);
  }
  return Boolean(extractInteractionOutputText(interaction));
};

export const terminalCompletedAt = (session: Session, completedAt = Date.now()): number | undefined =>
  session.completedAt ?? completedAt;

export const completedAtForInteraction = (
  session: Session,
  interaction: Interaction | undefined,
  completedAt = Date.now()
): number | undefined =>
  interaction && interactionIsTerminal(interaction)
    ? terminalCompletedAt(session, completedAt)
    : session.completedAt;

// Content identity for an event. The server does not currently send event
// ids, and the local seq changes on every delivery (a resume replay re-stamps
// everything), so identity must come from the payload itself — with seq
// stripped so a replayed copy hashes identically to the original.
const streamEventKey = (event: InteractionStreamEvent): string => {
  if (typeof event.event_id === "string" && event.event_id) {
    return `id:${event.event_id}`;
  }
  const { seq: _seq, ...payload } = event;
  return `${event.event_type}:${event.index ?? ""}:${JSON.stringify(payload).slice(0, 500)}`;
};

/**
 * Merges stream events idempotently across all delivery paths (live push,
 * 1s snapshot polls, and full replays after a stream reconnect). Identity is
 * content + occurrence count: the nth identical id-less event matches the nth
 * existing copy, so replays dedupe while a run that legitimately emits the
 * same delta twice keeps both.
 */
export const mergeStreamEvents = (
  current: InteractionStreamEvent[] | undefined,
  incoming: InteractionStreamEvent[]
): InteractionStreamEvent[] => {
  const merged = [...(current ?? [])];
  const existingCounts = new Map<string, number>();
  for (const event of merged) {
    const key = streamEventKey(event);
    existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
  }
  const incomingCounts = new Map<string, number>();
  for (const event of incoming) {
    const key = streamEventKey(event);
    const occurrence = (incomingCounts.get(key) ?? 0) + 1;
    incomingCounts.set(key, occurrence);
    if (occurrence <= (existingCounts.get(key) ?? 0)) {
      continue; // this copy is already represented (replay / double delivery)
    }
    merged.push(event);
    existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
  }
  // Canonical order by seq (push and snapshot arrivals interleave); the sort
  // is stable, so anything without a seq keeps its arrival order.
  return merged.sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0)).slice(-300);
};

export const latestStreamEventId = (events: InteractionStreamEvent[] | undefined): string | undefined =>
  [...(events ?? [])].reverse().find((event) => event.event_id)?.event_id;

export const shouldResumeBackgroundSession = (session: Session): boolean =>
  session.request.background === true &&
  Boolean(session.seed?.id) &&
  !session.streaming &&
  !session.error &&
  !interactionIsTerminal(session.seed!);

export const sessionCanReconnect = (session: Session): boolean =>
  Boolean(session.seed?.id) &&
  // Stream resume needs a stored interaction record; unstored runs have
  // nothing server-side to reconnect to.
  session.request.store === true &&
  !session.streaming &&
  (Boolean(session.error) || !interactionIsTerminal(session.seed!));

export const fallbackAgent = (agentId: string): ManagedAgent =>
  isDeepResearchAgentId(agentId)
    ? {
        id: agentId,
        base_agent: agentId.trim() as BaseAgentId,
        description: "Google Deep Research managed agent."
      }
    : {
        id: agentId,
        base_agent: ANTIGRAVITY_BASE_AGENT,
        description: "Preconfigured Gemini Anything managed agent."
      };
