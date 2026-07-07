import type { Interaction, InteractionCreateRequest, InteractionStreamEvent, ManagedAgent } from "@sdk";
import type { IpcError, PersistedSession } from "../../shared/electron-api";
import type { ImageAttachmentMeta, Session } from "./builderState";

const MAX_STORED_SESSIONS = 200;

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
  // Non-string status in a hand-edited or corrupted store would crash
  // status.toLowerCase() during render, taking every chat down with it.
  if (value.status !== undefined && typeof value.status !== "string") {
    return { ...value, status: undefined } as Interaction;
  }
  return value as Interaction;
};

const isEnvTarget = (target: string): boolean =>
  target.replace(/\\/g, "/").split("/").pop() === ".env";

const redactEnvContent = (content: string): string =>
  content.replace(/^([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*)=.*$/gim, "$1=<configured>");

const redactAgentSnapshotSecrets = (agent: ManagedAgent): ManagedAgent => {
  const environment = agent.base_environment;
  if (!isRecord(environment) || !Array.isArray(environment.sources)) {
    return agent;
  }

  return {
    ...agent,
    base_environment: {
      ...environment,
      sources: environment.sources.map((source) =>
        isRecord(source) &&
        source.type === "inline" &&
        typeof source.target === "string" &&
        typeof source.content === "string" &&
        isEnvTarget(source.target)
          ? {
              ...source,
              content: redactEnvContent(source.content)
            }
          : source
      )
    } as ManagedAgent["base_environment"]
  };
};

const sanitizeAgentSnapshot = (value: unknown): ManagedAgent | undefined => {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.base_agent !== "string") {
    return undefined;
  }
  return redactAgentSnapshotSecrets(value as ManagedAgent);
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

const sanitizeImageAttachments = (value: unknown): ImageAttachmentMeta[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const attachments = value.filter((item): item is ImageAttachmentMeta => {
    if (!isRecord(item)) {
      return false;
    }
    return (
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      typeof item.bytes === "number" &&
      Number.isFinite(item.bytes) &&
      typeof item.mimeType === "string" &&
      (typeof item.path === "undefined" || typeof item.path === "string")
    );
  });
  return attachments.length ? attachments : undefined;
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
      imageAttachments: sanitizeImageAttachments(item.imageAttachments),
      parentLocalId: typeof item.parentLocalId === "string" ? item.parentLocalId : undefined
    });
  }

  return pruneToWholeConversations(
    sessions.sort((left, right) => right.startedAt - left.startedAt)
  );
};

const conversationRootId = (session: Session, byId: Map<string, Session>): string => {
  let current = session;
  const seen = new Set<string>();
  while (current.parentLocalId && byId.has(current.parentLocalId) && !seen.has(current.localId)) {
    seen.add(current.localId);
    current = byId.get(current.parentLocalId)!;
  }
  return current.localId;
};

// Capping must drop whole conversations, newest-first: slicing raw sessions
// orphans children of pruned roots (splitting one chat into several after a
// restart) and deletes still-referenced conversation folders from disk.
const pruneToWholeConversations = (sessionsNewestFirst: Session[]): Session[] => {
  if (sessionsNewestFirst.length <= MAX_STORED_SESSIONS) {
    return sessionsNewestFirst;
  }
  const byId = new Map(sessionsNewestFirst.map((session) => [session.localId, session]));
  const keptRoots = new Set<string>();
  const kept: Session[] = [];
  for (const session of sessionsNewestFirst) {
    const rootId = conversationRootId(session, byId);
    if (!keptRoots.has(rootId)) {
      if (kept.length >= MAX_STORED_SESSIONS) {
        continue;
      }
      keptRoots.add(rootId);
    }
    kept.push(session);
  }
  return kept;
};

export type StoredSessionsReadResult = {
  ok: boolean;
  sessions: Session[];
};

export const readStoredSessions = async (): Promise<StoredSessionsReadResult> => {
  if (typeof window === "undefined" || !window.managedAgents?.loadStoredSessions) {
    return { ok: true, sessions: [] };
  }
  try {
    const result = await window.managedAgents.loadStoredSessions();
    return result.ok
      ? { ok: true, sessions: sanitizeSessionHistory(result.value.sessions) }
      : { ok: false, sessions: [] };
  } catch {
    return { ok: false, sessions: [] };
  }
};

// Session state changes on every stream event, so saves are coalesced: at most
// one disk write per interval, with the latest snapshot flushed on unload.
const SAVE_COALESCE_MS = 1000;
let pendingSessions: Session[] | null = null;
let saveTimer: number | null = null;
let flushOnUnloadRegistered = false;

const flushPendingSessions = (options: { sync?: boolean } = {}): void => {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!pendingSessions) {
    return;
  }
  const sessions = pendingSessions;
  pendingSessions = null;
  const payload = sanitizeSessionHistory(sessions) as PersistedSession[];
  // On unload an async IPC round-trip may not complete before the renderer
  // dies; the blocking channel guarantees the last snapshot reaches disk.
  if (options.sync && window.managedAgents?.saveStoredSessionsSync) {
    window.managedAgents.saveStoredSessionsSync(payload);
    return;
  }
  if (!window.managedAgents?.saveStoredSessions) {
    return;
  }
  window.managedAgents.saveStoredSessions(payload).catch((error: unknown) => {
    console.error("Failed to persist chat sessions", error);
  });
};

export const writeStoredSessions = (
  sessions: Session[]
): void => {
  if (typeof window === "undefined" || !window.managedAgents?.saveStoredSessions) {
    return;
  }
  pendingSessions = sessions;
  if (!flushOnUnloadRegistered) {
    flushOnUnloadRegistered = true;
    window.addEventListener("beforeunload", () => flushPendingSessions({ sync: true }));
  }
  if (saveTimer === null) {
    saveTimer = window.setTimeout(() => flushPendingSessions(), SAVE_COALESCE_MS);
  }
};

export const removeSessionsForAgent = (sessions: Session[], agentId: string): Session[] =>
  sessions.filter((session) => session.agentId !== agentId);

export const renameSessionsForAgent = (
  sessions: Session[],
  fromAgentId: string,
  toAgentId: string
): Session[] =>
  sessions.map((session) => {
    if (session.agentId !== fromAgentId) {
      return session;
    }
    return {
      ...session,
      agentId: toAgentId,
      agentSnapshot: { ...session.agentSnapshot, id: toAgentId } as ManagedAgent,
      request:
        session.request.agent === fromAgentId
          ? { ...session.request, agent: toAgentId }
          : session.request
    };
  });
