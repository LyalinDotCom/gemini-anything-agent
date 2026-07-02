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

export const mediaSearchTextForSession = (session: Session): string =>
  [
    extractInteractionOutputText(session.seed),
    ...timelineItemsForSession(session).flatMap((item) => [
      item.summary,
      item.body,
      ...(item.details?.flatMap((detail) => [detail.summary, detail.body]) ?? [])
    ])
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");

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
  "started"
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

// The main process stamps a monotonic seq on every buffered event, giving an
// exact identity: two legitimately identical deltas (same payload, same step)
// get distinct seq values and both survive, while the same event arriving via
// both the push channel and a snapshot poll dedups. The payload-hash fallback
// only applies to events persisted before seq existed.
const streamEventKey = (event: InteractionStreamEvent): string => {
  if (typeof event.seq === "number") {
    return `seq:${event.seq}`;
  }
  return event.event_id ?? `${event.event_type}:${event.index ?? ""}:${JSON.stringify(event).slice(0, 500)}`;
};

export const mergeStreamEvents = (
  current: InteractionStreamEvent[] | undefined,
  incoming: InteractionStreamEvent[]
): InteractionStreamEvent[] => {
  const merged = [...(current ?? [])];
  const seen = new Set(merged.map(streamEventKey));
  for (const event of incoming) {
    const key = streamEventKey(event);
    if (!seen.has(key)) {
      merged.push(event);
      seen.add(key);
    }
  }
  // Canonical order: pre-seq persisted events keep arrival order up front,
  // seq-stamped events sort by seq (push and snapshot arrivals interleave).
  const withoutSeq = merged.filter((event) => typeof event.seq !== "number");
  const withSeq = merged
    .filter((event) => typeof event.seq === "number")
    .sort((left, right) => (left.seq as number) - (right.seq as number));
  return [...withoutSeq, ...withSeq].slice(-300);
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
