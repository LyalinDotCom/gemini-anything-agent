import type { Interaction, InteractionCreateRequest, InteractionStreamEvent, ManagedAgent } from "@sdk";
import type { IpcError, ResolvedEnvironmentMedia } from "../../shared/electron-api";
import type { Session } from "./builderState";

export const SESSION_HISTORY_KEY = "gemini-anything-agent:sessions:v1";
const MAX_STORED_SESSIONS = 200;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type InputPart = Extract<InteractionCreateRequest["input"], unknown[]>[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isInputPart = (value: unknown): value is InputPart => {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  if (value.type === "text") {
    return typeof value.text === "string";
  }
  if (value.type === "image") {
    return typeof value.data === "string" && typeof value.mime_type === "string";
  }
  return false;
};

const isInteractionInput = (value: unknown): value is InteractionCreateRequest["input"] =>
  typeof value === "string" || (Array.isArray(value) && value.every(isInputPart));

const isEnvironmentReference = (value: unknown): value is InteractionCreateRequest["environment"] =>
  typeof value === "string" || isRecord(value);

const sanitizeRequest = (value: unknown): InteractionCreateRequest | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.agent !== "string" ||
    !isEnvironmentReference(value.environment) ||
    !isInteractionInput(value.input)
  ) {
    return undefined;
  }
  return value as InteractionCreateRequest;
};

const sanitizeInteraction = (value: unknown): Interaction | undefined => {
  if (!isRecord(value) || typeof value.id !== "string") {
    return undefined;
  }
  return value as Interaction;
};

const sanitizeAgentSnapshot = (value: unknown): ManagedAgent | undefined => {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.base_agent !== "string") {
    return undefined;
  }
  return value as ManagedAgent;
};

const sanitizeEvents = (value: unknown): InteractionStreamEvent[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const events = value.filter(
    (event): event is InteractionStreamEvent =>
      isRecord(event) && typeof event.event_type === "string"
  );
  return events.length ? events.slice(-300) : undefined;
};

const sanitizeError = (value: unknown): IpcError | undefined => {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.message !== "string") {
    return undefined;
  }
  return {
    name: value.name,
    message: value.message,
    status: typeof value.status === "number" ? value.status : undefined,
    errors: Array.isArray(value.errors) && value.errors.every((item) => typeof item === "string")
      ? value.errors
      : undefined,
    details: value.details
  };
};

const isMediaType = (value: unknown): value is ResolvedEnvironmentMedia["mediaType"] =>
  value === "image" || value === "video" || value === "audio";

const sanitizeResolvedMedia = (value: unknown): ResolvedEnvironmentMedia[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const media = value.filter((item): item is ResolvedEnvironmentMedia => {
    if (!isRecord(item)) {
      return false;
    }
    return (
      typeof item.requestedPath === "string" &&
      typeof item.path === "string" &&
      typeof item.url === "string" &&
      (typeof item.savedPath === "undefined" || typeof item.savedPath === "string") &&
      isMediaType(item.mediaType)
    );
  });
  return media.length ? media : undefined;
};

export const sanitizeSessionHistory = (value: unknown): Session[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const sessions: Session[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const request = sanitizeRequest(item.request);
    const agentSnapshot = sanitizeAgentSnapshot(item.agentSnapshot);
    if (
      !request ||
      !agentSnapshot ||
      typeof item.localId !== "string" ||
      typeof item.agentId !== "string" ||
      typeof item.startedAt !== "number" ||
      !Number.isFinite(item.startedAt) ||
      seen.has(item.localId)
    ) {
      continue;
    }

    seen.add(item.localId);
    sessions.push({
      localId: item.localId,
      agentId: item.agentId,
      agentSnapshot,
      request,
      seed: sanitizeInteraction(item.seed),
      events: sanitizeEvents(item.events),
      streaming: false,
      streamId: undefined,
      startedAt: item.startedAt,
      completedAt:
        typeof item.completedAt === "number" && Number.isFinite(item.completedAt)
          ? item.completedAt
          : undefined,
      error: sanitizeError(item.error),
      resolvedMedia: sanitizeResolvedMedia(item.resolvedMedia),
      parentLocalId: typeof item.parentLocalId === "string" ? item.parentLocalId : undefined
    });
  }

  return sessions
    .sort((left, right) => right.startedAt - left.startedAt)
    .slice(0, MAX_STORED_SESSIONS);
};

const getBrowserStorage = (): StorageLike | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export const readStoredSessions = (storage = getBrowserStorage()): Session[] => {
  if (!storage) {
    return [];
  }
  try {
    const raw = storage.getItem(SESSION_HISTORY_KEY);
    return raw ? sanitizeSessionHistory(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
};

export const writeStoredSessions = (
  sessions: Session[],
  storage = getBrowserStorage()
): void => {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(SESSION_HISTORY_KEY, JSON.stringify(sanitizeSessionHistory(sessions)));
  } catch {
    try {
      storage.removeItem(SESSION_HISTORY_KEY);
    } catch {
      // Ignore storage failures; run history is helpful state, not required app state.
    }
  }
};

export const removeSessionsForAgent = (sessions: Session[], agentId: string): Session[] =>
  sessions.filter((session) => session.agentId !== agentId);

export const renameSessionsForAgent = (
  sessions: Session[],
  fromAgentId: string,
  toAgentId: string
): Session[] =>
  sessions.map((session) =>
    session.agentId === fromAgentId ? { ...session, agentId: toAgentId } : session
  );
