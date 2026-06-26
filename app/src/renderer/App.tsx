import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Download,
  Maximize2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  X,
  XCircle
} from "lucide-react";
import {
  ANTIGRAVITY_BASE_AGENT,
  extractInteractionOutputText,
  managedAgentManifest,
  validateInteractionCreate,
  type Interaction,
  type InteractionCreateRequest,
  type InteractionInput,
  type InteractionStreamEvent,
  type ManagedAgent,
  type ToolType
} from "@sdk";
import type {
  EnsureAnythingAgentResult,
  InteractionStreamSnapshot,
  IpcError,
  ResolvedEnvironmentMedia,
  RuntimeConfig
} from "../shared/electron-api";
import {
  initialCompose,
  uid,
  type ComposeState,
  type ImagePartDraft,
  type Session
} from "./lib/builderState";
import {
  readStoredSessions,
  writeStoredSessions
} from "./lib/sessionStore";
import {
  latestContinuableSession,
  latestReusableEnvironmentSession,
  sessionEnvironmentId,
  withAutoContinuation,
  withAutoEnvironment
} from "./lib/continuity";
import { buildTimeline, type TimelineItem } from "./lib/timeline";
import { Composer } from "./components/Composer";
import { Transcript } from "./components/Transcript";
import { BufferedAudio } from "./components/BufferedAudio";
import { SettingsModal } from "./components/Overlays";

type StatusEvent = {
  id: string;
  level: "info" | "success" | "error";
  title: string;
  detail?: string;
};

type PendingComposeInput = Pick<ComposeState, "inputMode" | "input" | "parts">;

type ConversationSummary = {
  id: string;
  title: string;
  sessions: Session[];
  latestAt: number;
  environmentId?: string;
};

type SessionMediaState = {
  loading: boolean;
  items: ResolvedEnvironmentMedia[];
  error?: string;
  progress?: number;
  stage?: string;
};

const FALLBACK_RUNTIME: RuntimeConfig = {
  hasApiKey: false,
  apiRevision: managedAgentManifest.api.apiRevision,
  baseUrl: managedAgentManifest.api.baseUrl,
  envPath: ".env",
  docsLastChecked: "2026-06-22",
  agentId: "gemini-anything-agent",
  npmPackage: "@lyalindotcom/gai",
  npmVersion: "latest"
};

const ALL_AGENT_TOOLS: ToolType[] = ["code_execution", "google_search", "url_context"];
const NEW_CONVERSATION_ID = "new";

const bridgeUnavailable: IpcError = {
  name: "BridgeUnavailable",
  message: "Run the Electron app with npm run dev for live managed-agent calls."
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const composeInputSnapshot = (state: ComposeState): PendingComposeInput => ({
  inputMode: state.inputMode,
  input: state.input,
  parts: state.parts.map((part) => ({ ...part }))
});

const clearComposeInput = (state: ComposeState): ComposeState => ({
  ...state,
  input: "",
  parts: []
});

const restoreComposeInput = (
  state: ComposeState,
  snapshot: PendingComposeInput
): ComposeState => ({
  ...state,
  inputMode: snapshot.inputMode,
  input: snapshot.input,
  parts: snapshot.parts.map((part) => ({ ...part }))
});

const composeToInput = (compose: ComposeState): InteractionInput => {
  const images = compose.parts.filter((part): part is ImagePartDraft => part.kind === "image");
  const text = compose.input.trim();
  if (images.length === 0) {
    return compose.input;
  }
  return [
    ...(text ? [{ type: "text" as const, text: compose.input }] : []),
    ...images.map((part) => ({ type: "image" as const, data: part.data, mime_type: part.mimeType }))
  ];
};

const hasComposeInput = (compose: ComposeState): boolean =>
  compose.input.trim().length > 0 || compose.parts.some((part) => part.kind === "image");

const buildChatInteraction = (
  agentId: string,
  compose: ComposeState
): InteractionCreateRequest => {
  const request: InteractionCreateRequest = {
    agent: agentId,
    input: composeToInput(compose),
    environment: "remote",
    store: compose.store
  };

  if (compose.background && compose.store) {
    request.background = true;
  }
  if (compose.serviceTier !== "standard") {
    request.service_tier = compose.serviceTier;
  }
  if (compose.thinkingSummaries !== "none") {
    request.agent_config = {
      type: "dynamic",
      thinking_summaries: compose.thinkingSummaries
    };
  }
  if (compose.previousInteractionId.trim()) {
    request.previous_interaction_id = compose.previousInteractionId.trim();
  }
  if (compose.overrideSystemInstruction && compose.systemInstruction.trim()) {
    request.system_instruction = compose.systemInstruction.trim();
  }
  if (compose.overrideTools) {
    request.tools = ALL_AGENT_TOOLS.map((type) => ({ type }));
  }
  if (compose.overrideEnvironment && compose.environmentId.trim()) {
    request.environment = compose.environmentId.trim();
  }

  return request;
};

const promptForInput = (input: InteractionCreateRequest["input"]): string => {
  if (typeof input === "string") {
    return input;
  }
  return input
    .map((part) => (part.type === "text" ? part.text : `[${part.mime_type} image]`))
    .join("\n")
    .trim();
};

const firstPromptLine = (input: InteractionCreateRequest["input"]): string => {
  const prompt = promptForInput(input).trim().replace(/\s+/g, " ");
  if (!prompt) {
    return "Untitled conversation";
  }
  return prompt.length > 54 ? `${prompt.slice(0, 53)}...` : prompt;
};

const formatConversationTime = (value: number): string =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });

const MEDIA_PATH_PATTERN =
  /(?:\/workspace\/|workspace\/|\/tmp\/|outputs\/)[^\s`"'()[\]{}<>]+\.(?:png|jpe?g|webp|gif|avif|svg|mp4|webm|mov|m4v|wav|mp3|m4a|aac|ogg|flac)(?:[?#][^\s`"'()[\]{}<>]+)?/gi;

const cleanMediaPath = (value: string): string =>
  value.replace(/[),.;:!?]+$/g, "").replace(/[?#].*$/, "");

const extractMediaPaths = (text: string | undefined): string[] => {
  if (!text) {
    return [];
  }
  return [...new Set([...text.matchAll(MEDIA_PATH_PATTERN)].map((match) => cleanMediaPath(match[0])))];
};

const SessionMedia = ({
  state,
  onSave,
  onRetry,
  onOpen
}: {
  state: SessionMediaState | undefined;
  onSave: (item: ResolvedEnvironmentMedia) => void;
  onRetry: () => void;
  onOpen: (item: ResolvedEnvironmentMedia) => void;
}) => {
  if (!state || (!state.loading && state.items.length === 0 && !state.error)) {
    return null;
  }

  return (
    <div className="session-media">
      {state.loading && (
        <div className="media-progress">
          <span>{state.stage ?? "Downloading generated media..."}</span>
          <div className="media-progress-track" aria-hidden="true">
            <span style={{ width: `${state.progress ?? 35}%` }} />
          </div>
        </div>
      )}
      {state.error && (
        <div className="media-error-row">
          <span className="media-error">{state.error}</span>
          <button type="button" className="ghost-button sm" onClick={onRetry}>
            Retry download
          </button>
        </div>
      )}
      {state.items.map((item) => (
        <figure
          className={`media-card media-${item.mediaType}`}
          key={`${item.requestedPath}:${item.url}`}
          onClick={(event) => {
            const tag = event.target instanceof HTMLElement ? event.target.tagName.toLowerCase() : "";
            if (tag !== "video" && tag !== "audio" && tag !== "button") {
              onOpen(item);
            }
          }}
        >
          {item.mediaType === "image" ? (
            <img src={item.url} alt={item.requestedPath} loading="lazy" onClick={() => onOpen(item)} />
          ) : item.mediaType === "video" ? (
            <video src={item.url} controls preload="metadata" />
          ) : (
            <BufferedAudio src={item.url} />
          )}
          <figcaption>
            <span>
              {item.requestedPath}
              {item.savedPath && (
                <>
                  <br />
                  Saved locally: <code>{item.savedPath}</code>
                </>
              )}
            </span>
            <button type="button" className="ghost-button sm" onClick={() => onSave(item)}>
              <Download size={12} />
              Save As
            </button>
            <button type="button" className="ghost-button sm" onClick={() => onOpen(item)}>
              <Maximize2 size={12} />
              Open
            </button>
            <button type="button" className="ghost-button sm" onClick={onRetry}>
              Redownload
            </button>
          </figcaption>
        </figure>
      ))}
    </div>
  );
};

const MediaLightbox = ({
  item,
  onClose
}: {
  item: ResolvedEnvironmentMedia | null;
  onClose: () => void;
}) => {
  if (!item) {
    return null;
  }

  return (
    <div className="media-lightbox-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className={`media-lightbox media-${item.mediaType}`} onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <strong>{item.requestedPath}</strong>
            {item.savedPath && <code>{item.savedPath}</code>}
          </div>
          <button type="button" className="ghost-button sm" onClick={onClose}>
            <X size={14} />
            Close
          </button>
        </header>
        <div className="media-lightbox-body">
          {item.mediaType === "image" ? (
            <img src={item.url} alt={item.requestedPath} />
          ) : item.mediaType === "video" ? (
            <video src={item.url} controls autoPlay />
          ) : (
            <BufferedAudio src={item.url} autoPlay />
          )}
        </div>
      </div>
    </div>
  );
};

const conversationRootId = (
  session: Session,
  byId: Map<string, Session>
): string => {
  let current = session;
  const seen = new Set<string>();
  while (current.parentLocalId && byId.has(current.parentLocalId) && !seen.has(current.localId)) {
    seen.add(current.localId);
    current = byId.get(current.parentLocalId)!;
  }
  return current.localId;
};

const buildConversations = (agentSessions: Session[]): ConversationSummary[] => {
  const byId = new Map(agentSessions.map((session) => [session.localId, session]));
  const grouped = new Map<string, Session[]>();
  for (const session of agentSessions) {
    const rootId = conversationRootId(session, byId);
    grouped.set(rootId, [...(grouped.get(rootId) ?? []), session]);
  }

  return [...grouped.entries()]
    .map(([id, group]) => {
      const sorted = [...group].sort((left, right) => left.startedAt - right.startedAt);
      const latestAt = sorted.reduce((max, session) => Math.max(max, session.startedAt), 0);
      return {
        id,
        title: firstPromptLine(sorted[0]?.request.input ?? ""),
        sessions: sorted,
        latestAt,
        environmentId: [...sorted].reverse().map(sessionEnvironmentId).find((value): value is string => Boolean(value))
      };
    })
    .sort((left, right) => right.latestAt - left.latestAt);
};

const timelineItemsForSession = (session: Session): TimelineItem[] => {
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

const mediaSearchTextForSession = (session: Session): string =>
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

const patchSeedFromStreamEvent = (
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

const patchSeedFromStreamSnapshot = (
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

const interactionIsTerminal = (interaction: Interaction): boolean => {
  if (extractInteractionOutputText(interaction)) {
    return true;
  }
  const status = interaction.status?.toLowerCase();
  return Boolean(status && !NON_TERMINAL_INTERACTION_STATUS.has(status));
};

const terminalCompletedAt = (session: Session, completedAt = Date.now()): number | undefined =>
  session.completedAt ?? completedAt;

const completedAtForInteraction = (
  session: Session,
  interaction: Interaction | undefined,
  completedAt = Date.now()
): number | undefined =>
  interaction && interactionIsTerminal(interaction)
    ? terminalCompletedAt(session, completedAt)
    : session.completedAt;

const streamEventKey = (event: InteractionStreamEvent): string =>
  event.event_id ?? `${event.event_type}:${event.index ?? ""}:${JSON.stringify(event).slice(0, 500)}`;

const mergeStreamEvents = (
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
  return merged.slice(-300);
};

const latestStreamEventId = (events: InteractionStreamEvent[] | undefined): string | undefined =>
  [...(events ?? [])].reverse().find((event) => event.event_id)?.event_id;

const shouldResumeBackgroundSession = (session: Session): boolean =>
  session.request.background === true &&
  Boolean(session.seed?.id) &&
  !session.streaming &&
  !session.error &&
  !interactionIsTerminal(session.seed!);

const fallbackAgent = (agentId: string): ManagedAgent => ({
  id: agentId,
  base_agent: ANTIGRAVITY_BASE_AGENT,
  description: "Preconfigured Gemini Anything managed agent."
});

const snapshotAgentForRun = async (
  agentId: string,
  fallback: ManagedAgent
): Promise<ManagedAgent> => {
  if (!window.managedAgents) {
    return fallback;
  }
  try {
    const result = await window.managedAgents.getAgent(agentId);
    return result.ok ? result.value : fallback;
  } catch {
    return fallback;
  }
};

export const App = () => {
  const [runtime, setRuntime] = useState<RuntimeConfig | null>(null);
  const [compose, setCompose] = useState<ComposeState>(initialCompose);
  const [sessions, setSessions] = useState<Session[]>(() => readStoredSessions());
  const [status, setStatus] = useState<StatusEvent | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [latestRunId, setLatestRunId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string>(NEW_CONVERSATION_ID);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mediaBySession, setMediaBySession] = useState<Record<string, SessionMediaState>>({});
  const [activeMedia, setActiveMedia] = useState<ResolvedEnvironmentMedia | null>(null);
  const activeResumeIds = useRef<Set<string>>(new Set());
  const pendingRunInputs = useRef<Map<string, PendingComposeInput>>(new Map());
  const requestedMediaKeys = useRef<Set<string>>(new Set());
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const config = runtime ?? FALLBACK_RUNTIME;
  const agentId = config.agentId.trim() || FALLBACK_RUNTIME.agentId;
  const hasBridge = Boolean(window.managedAgents);
  const hasKey = Boolean(runtime?.hasApiKey);
  const agentSessions = useMemo(
    () => sessions.filter((session) => session.agentId === agentId),
    [agentId, sessions]
  );
  const conversations = useMemo(
    () => buildConversations(agentSessions),
    [agentSessions]
  );
  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId),
    [activeConversationId, conversations]
  );
  const selectedSessions = selectedConversation?.sessions ?? [];
  const chatSessions = useMemo(
    () => [...selectedSessions].sort((left, right) => left.startedAt - right.startedAt),
    [selectedSessions]
  );
  const baseInteraction = useMemo(
    () => buildChatInteraction(agentId, compose),
    [agentId, compose]
  );
  const autoContinuation = useMemo(
    () =>
      compose.store && compose.autoContinue && !baseInteraction.previous_interaction_id
        ? latestContinuableSession(selectedSessions, baseInteraction.agent)
        : undefined,
    [
      baseInteraction.agent,
      baseInteraction.previous_interaction_id,
      compose.autoContinue,
      compose.store,
      selectedSessions
    ]
  );
  const autoEnvironment = useMemo(
    () =>
      compose.reuseEnvironment && baseInteraction.environment === "remote"
        ? latestReusableEnvironmentSession(selectedSessions, baseInteraction.agent)
        : undefined,
    [
      baseInteraction.agent,
      baseInteraction.environment,
      compose.reuseEnvironment,
      selectedSessions
    ]
  );
  const interactionWithContinuation = useMemo(
    () => withAutoContinuation(baseInteraction, selectedSessions, compose.autoContinue),
    [baseInteraction, compose.autoContinue, selectedSessions]
  );
  const interaction = useMemo(
    () => withAutoEnvironment(interactionWithContinuation, selectedSessions, compose.reuseEnvironment),
    [compose.reuseEnvironment, interactionWithContinuation, selectedSessions]
  );
  const runningSession = useMemo(
    () => selectedSessions.find((session) => session.streaming),
    [selectedSessions]
  );
  const latestEnvironmentId = selectedConversation?.environmentId;
  const canRun = hasBridge && hasKey && busy === null && hasComposeInput(compose);

  const scrollChatToBottom = () => {
    const scroll = () => {
      const node = chatScrollRef.current;
      if (node) {
        node.scrollTop = node.scrollHeight;
      }
    };
    scroll();
    requestAnimationFrame(() => {
      scroll();
      requestAnimationFrame(scroll);
    });
  };

  useEffect(() => {
    void loadRuntime();
  }, []);

  useEffect(() => {
    writeStoredSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    scrollChatToBottom();
  }, [chatSessions, latestRunId]);

  useEffect(() => {
    scrollChatToBottom();
  }, [mediaBySession]);

  useEffect(() => {
    if (activeConversationId === NEW_CONVERSATION_ID) {
      return;
    }
    if (activeConversationId === latestRunId) {
      return;
    }
    if (!conversations.some((conversation) => conversation.id === activeConversationId)) {
      setActiveConversationId(conversations[0]?.id ?? NEW_CONVERSATION_ID);
    }
  }, [activeConversationId, conversations, latestRunId]);

  useEffect(() => {
    if (!window.managedAgents?.resolveEnvironmentMedia) {
      return;
    }
    for (const session of chatSessions) {
      void resolveMediaForSession(session);
    }
  }, [chatSessions]);

  useEffect(() => {
    if (!hasBridge || !runtime?.hasApiKey || !window.managedAgents?.resumeInteractionStream) {
      return;
    }
    for (const session of agentSessions) {
      if (shouldResumeBackgroundSession(session) && !activeResumeIds.current.has(session.localId)) {
        void resumeSessionStream(session);
      }
    }
  }, [agentSessions, hasBridge, runtime?.hasApiKey]);

  const pushStatus = (event: Omit<StatusEvent, "id">) => {
    setStatus({ ...event, id: uid() });
  };

  const restorePendingRunInput = (localId: string) => {
    const snapshot = pendingRunInputs.current.get(localId);
    if (!snapshot) {
      return;
    }
    pendingRunInputs.current.delete(localId);
    setCompose((current) => restoreComposeInput(current, snapshot));
  };

  const forgetPendingRunInputIfTerminal = (localId: string, value: Interaction | undefined) => {
    if (value && interactionIsTerminal(value)) {
      pendingRunInputs.current.delete(localId);
    }
  };

  async function loadRuntime() {
    if (!window.managedAgents) {
      setRuntime(FALLBACK_RUNTIME);
      return;
    }
    const result = await window.managedAgents.getRuntimeConfig();
    setRuntime(result.ok ? result.value : FALLBACK_RUNTIME);
  }

  async function ensureAgentBeforeRun(
    bridge: NonNullable<typeof window.managedAgents>,
    targetAgentId: string
  ): Promise<EnsureAnythingAgentResult | undefined> {
    setBusy("deploy");
    try {
      const result = await bridge.ensureAnythingAgent(targetAgentId);
      if (!result.ok) {
        pushStatus({ level: "error", title: result.error.name, detail: result.error.message });
        return undefined;
      }
      pushStatus({
        level: "success",
        title: result.value.recreated ? "Agent refreshed" : result.value.created ? "Agent deployed" : "Agent ready",
        detail: `${result.value.agent.id} (${result.value.sourceTargets.length} sandbox files)`
      });
      return result.value;
    } finally {
      setBusy(null);
    }
  }

  async function runInteraction() {
    if (!hasComposeInput(compose)) {
      pushStatus({ level: "error", title: "Prompt required", detail: "Type a message or attach an image." });
      return;
    }
    if (!hasBridge) {
      pushStatus({ level: "error", title: bridgeUnavailable.name, detail: bridgeUnavailable.message });
      return;
    }
    const bridge = window.managedAgents;
    if (!bridge) {
      pushStatus({ level: "error", title: bridgeUnavailable.name, detail: bridgeUnavailable.message });
      return;
    }
    if (!hasKey) {
      pushStatus({ level: "error", title: "API key required", detail: "Open Settings and add GEMINI_API_KEY." });
      setSettingsOpen(true);
      return;
    }

    const ensuredAgent = await ensureAgentBeforeRun(bridge, agentId);
    if (!ensuredAgent) {
      return;
    }

    const check = validateInteractionCreate(interaction);
    if (!check.ok) {
      pushStatus({ level: "error", title: "Interaction invalid", detail: check.errors.join("\n") });
      return;
    }

    const request = check.value;
    if (ensuredAgent.created || ensuredAgent.recreated) {
      request.environment = "remote";
    }
    const localId = uid();
    const streamId = uid();
    const parent = selectedSessions.find((session) => session.seed?.id === request.previous_interaction_id);
    const startsNewConversation = !parent;
    pendingRunInputs.current.set(localId, composeInputSnapshot(compose));
    setCompose((current) => clearComposeInput(current));
    setBusy("run");
    setLatestRunId(localId);

    const agentSnapshot = await snapshotAgentForRun(request.agent, fallbackAgent(request.agent));
    const base: Session = {
      localId,
      agentId: request.agent,
      agentSnapshot,
      request,
      startedAt: Date.now(),
      parentLocalId: parent?.localId
    };

    try {
      const createInteractionStream = bridge.createInteractionStream;
      const onInteractionStreamEvent = bridge.onInteractionStreamEvent;
      const getInteractionStreamSnapshot = bridge.getInteractionStreamSnapshot;
      if (createInteractionStream && (onInteractionStreamEvent || getInteractionStreamSnapshot)) {
        const unsubscribe = onInteractionStreamEvent?.(streamId, (event) => {
          setSessions((current) =>
            current.map((session) =>
              session.localId === localId
                ? {
                    ...session,
                    seed: patchSeedFromStreamEvent(session.seed, event),
                    events: mergeStreamEvents(session.events, [event])
                  }
                : session
            )
          );
        }) ?? (() => undefined);

        setSessions((current) => [{ ...base, events: [], streaming: true, streamId }, ...current]);
        if (startsNewConversation) {
          setActiveConversationId(localId);
        }
        let snapshotTimer: ReturnType<typeof setInterval> | undefined;
        const syncStreamSnapshot = async () => {
          if (!getInteractionStreamSnapshot) {
            return;
          }
          const snapshot = await getInteractionStreamSnapshot(streamId);
          if (!snapshot.ok) {
            return;
          }
          if (snapshot.value.done && snapshot.value.events.length === 0 && !snapshot.value.latestInteraction) {
            return;
          }
          setSessions((current) =>
            current.map((session) =>
              session.localId === localId
                ? (() => {
                    const nextSeed = patchSeedFromStreamSnapshot(session.seed, snapshot.value);
                    return {
                      ...session,
                      seed: nextSeed,
                      events: mergeStreamEvents(session.events, snapshot.value.events),
                      streaming: !snapshot.value.done,
                      completedAt: snapshot.value.done
                        ? completedAtForInteraction(session, nextSeed)
                        : session.completedAt
                    };
                  })()
                : session
            )
          );
        };

        const streamPromise = createInteractionStream(streamId, request);
        if (getInteractionStreamSnapshot) {
          snapshotTimer = setInterval(() => {
            void syncStreamSnapshot();
          }, 1000);
          void syncStreamSnapshot();
        }
        const result = await (async () => {
          try {
            return await streamPromise;
          } finally {
            if (snapshotTimer) {
              clearInterval(snapshotTimer);
              await syncStreamSnapshot();
            }
            unsubscribe();
          }
        })();

        if (result.ok) {
          forgetPendingRunInputIfTerminal(localId, result.value);
          setSessions((current) =>
            current.map((session) =>
              session.localId === localId
                ? {
                    ...session,
                    seed: result.value,
                    streaming: false,
                    streamId: undefined,
                    completedAt: completedAtForInteraction(session, result.value)
                  }
                : session
            )
          );
          if (request.store === true) {
            setCompose((current) => ({ ...current, previousInteractionId: "", autoContinue: true }));
          }
        } else {
          restorePendingRunInput(localId);
          setSessions((current) =>
            current.map((session) =>
              session.localId === localId
                ? {
                    ...session,
                    error: result.error,
                    streaming: false,
                    streamId: undefined,
                    completedAt: terminalCompletedAt(session)
                  }
                : session
            )
          );
          pushStatus({ level: "error", title: result.error.name, detail: result.error.message });
        }
        return;
      }

      const result = await bridge.createInteraction(request);
      if (result.ok) {
        forgetPendingRunInputIfTerminal(localId, result.value);
        setSessions((current) => [
          { ...base, seed: result.value, completedAt: interactionIsTerminal(result.value) ? Date.now() : undefined },
          ...current
        ]);
        if (startsNewConversation) {
          setActiveConversationId(localId);
        }
        if (request.store === true) {
          setCompose((current) => ({ ...current, previousInteractionId: "", autoContinue: true }));
        }
      } else {
        restorePendingRunInput(localId);
        setSessions((current) => [{ ...base, error: result.error, completedAt: Date.now() }, ...current]);
        if (startsNewConversation) {
          setActiveConversationId(localId);
        }
        pushStatus({ level: "error", title: result.error.name, detail: result.error.message });
      }
    } finally {
      setBusy(null);
    }
  }

  async function resumeSessionStream(sessionToResume: Session) {
    const interactionId = sessionToResume.seed?.id;
    if (!interactionId || !window.managedAgents?.resumeInteractionStream) {
      return;
    }
    if (activeResumeIds.current.has(sessionToResume.localId)) {
      return;
    }

    const streamId = uid();
    const lastEventId = latestStreamEventId(sessionToResume.events);
    activeResumeIds.current.add(sessionToResume.localId);
    setSessions((current) =>
      current.map((session) =>
        session.localId === sessionToResume.localId
          ? { ...session, streaming: true, streamId }
          : session
      )
    );

    const unsubscribe = window.managedAgents.onInteractionStreamEvent?.(streamId, (event) => {
      setSessions((current) =>
        current.map((session) =>
          session.localId === sessionToResume.localId
            ? {
                ...session,
                seed: patchSeedFromStreamEvent(session.seed, event),
                events: mergeStreamEvents(session.events, [event])
              }
            : session
        )
      );
    }) ?? (() => undefined);

    const getInteractionStreamSnapshot = window.managedAgents.getInteractionStreamSnapshot;
    let snapshotTimer: ReturnType<typeof setInterval> | undefined;
    const syncStreamSnapshot = async () => {
      if (!getInteractionStreamSnapshot) {
        return;
      }
      const snapshot = await getInteractionStreamSnapshot(streamId);
      if (!snapshot.ok) {
        return;
      }
      if (snapshot.value.done && snapshot.value.events.length === 0 && !snapshot.value.latestInteraction) {
        return;
      }
      setSessions((current) =>
        current.map((session) =>
          session.localId === sessionToResume.localId
            ? (() => {
                const nextSeed = patchSeedFromStreamSnapshot(session.seed, snapshot.value);
                return {
                  ...session,
                  seed: nextSeed,
                  events: mergeStreamEvents(session.events, snapshot.value.events),
                  streaming: !snapshot.value.done,
                  completedAt: snapshot.value.done
                    ? completedAtForInteraction(session, nextSeed)
                    : session.completedAt
                };
              })()
            : session
        )
      );
    };

    try {
      const streamPromise = window.managedAgents.resumeInteractionStream(streamId, interactionId, lastEventId);
      if (getInteractionStreamSnapshot) {
        snapshotTimer = setInterval(() => {
          void syncStreamSnapshot();
        }, 1000);
        void syncStreamSnapshot();
      }
      const result = await (async () => {
        try {
          return await streamPromise;
        } finally {
          if (snapshotTimer) {
            clearInterval(snapshotTimer);
            await syncStreamSnapshot();
          }
          unsubscribe();
        }
      })();

      if (result.ok) {
        setSessions((current) =>
          current.map((session) =>
            session.localId === sessionToResume.localId
              ? {
                  ...session,
                  seed: result.value,
                  error: undefined,
                  streaming: false,
                  streamId: undefined,
                  completedAt: completedAtForInteraction(session, result.value)
                }
              : session
          )
        );
      } else {
        setSessions((current) =>
          current.map((session) =>
            session.localId === sessionToResume.localId
              ? {
                  ...session,
                  error: result.error,
                  streaming: false,
                  streamId: undefined,
                  completedAt: terminalCompletedAt(session)
                }
              : session
          )
        );
        pushStatus({ level: "error", title: result.error.name, detail: result.error.message });
      }
    } finally {
      activeResumeIds.current.delete(sessionToResume.localId);
    }
  }

  async function cancelSession(sessionToCancel: Session) {
    if (!window.managedAgents) {
      pushStatus({ level: "error", title: bridgeUnavailable.name, detail: bridgeUnavailable.message });
      return;
    }
    if (busy === "cancel") {
      return;
    }
    const interactionId = sessionToCancel.seed?.id;
    const streamId = sessionToCancel.streamId;
    if (!interactionId && !streamId) {
      pushStatus({ level: "error", title: "Cancel unavailable", detail: "This run has no active interaction id." });
      return;
    }

    setBusy("cancel");
    try {
      let cancelledInteraction: Interaction | undefined;
      if (interactionId) {
        const cancelled = await window.managedAgents.cancelInteraction(interactionId);
        if (!cancelled.ok) {
          pushStatus({ level: "error", title: cancelled.error.name, detail: cancelled.error.message });
          return;
        }
        cancelledInteraction = cancelled.value;
      }

      if (streamId && window.managedAgents.cancelInteractionStream) {
        await window.managedAgents.cancelInteractionStream(streamId);
      }

      setSessions((current) =>
        current.map((session) =>
          session.localId === sessionToCancel.localId
            ? {
                ...session,
                seed: cancelledInteraction
                  ? { ...(session.seed ?? cancelledInteraction), ...cancelledInteraction }
                  : session.seed,
                error: cancelledInteraction
                  ? undefined
                  : { name: "Cancelled", message: "Run stream cancelled locally." },
                streaming: false,
                streamId: undefined,
                completedAt: cancelledInteraction
                  ? completedAtForInteraction(session, cancelledInteraction) ?? terminalCompletedAt(session)
                  : terminalCompletedAt(session)
              }
            : session
        )
      );
      restorePendingRunInput(sessionToCancel.localId);
      pushStatus({ level: "success", title: "Cancelled run", detail: interactionId ?? sessionToCancel.localId });
    } finally {
      setBusy(null);
    }
  }

  async function snapshotEnvironment(environmentId: string) {
    if (!window.managedAgents) {
      pushStatus({ level: "error", title: bridgeUnavailable.name, detail: bridgeUnavailable.message });
      return;
    }
    setBusy("snapshot");
    try {
      const result = await window.managedAgents.downloadEnvironmentSnapshot(environmentId);
      if (result.ok && result.value.saved) {
        pushStatus({ level: "success", title: "Snapshot saved", detail: result.value.path });
      } else if (!result.ok) {
        pushStatus({ level: "error", title: result.error.name, detail: result.error.message });
      }
    } finally {
      setBusy(null);
    }
  }

  async function saveApiKey(key: string): Promise<boolean> {
    if (!window.managedAgents) {
      pushStatus({ level: "error", title: bridgeUnavailable.name, detail: bridgeUnavailable.message });
      return false;
    }
    setBusy("save-key");
    try {
      const result = await window.managedAgents.setApiKey(key);
      if (!result.ok) {
        pushStatus({ level: "error", title: result.error.name, detail: result.error.message });
        return false;
      }
      await loadRuntime();
      pushStatus({ level: "success", title: "API key saved", detail: result.value.envPath });
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function clearApiKey() {
    if (!window.confirm("Remove the API key from .env?")) {
      return;
    }
    await saveApiKey("");
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      pushStatus({ level: "success", title: label, detail: "Copied to clipboard" });
    } catch {
      pushStatus({ level: "error", title: "Copy failed", detail: "Clipboard unavailable" });
    }
  }

  async function saveMedia(item: ResolvedEnvironmentMedia) {
    if (!window.managedAgents?.saveResolvedMedia) {
      pushStatus({ level: "error", title: "Save unavailable", detail: "Run the Electron app to save media." });
      return;
    }
    const result = await window.managedAgents.saveResolvedMedia(item.path);
    if (!result.ok) {
      pushStatus({ level: "error", title: result.error.name, detail: result.error.message });
      return;
    }
    if (result.value.saved) {
      pushStatus({ level: "success", title: "Media saved", detail: result.value.path });
    }
  }

  async function resolveMediaForSession(session: Session, force = false) {
    if (!window.managedAgents?.resolveEnvironmentMedia) {
      return;
    }
    const environmentId = sessionEnvironmentId(session);
    const paths = extractMediaPaths(mediaSearchTextForSession(session));
    if (!environmentId || paths.length === 0 || session.streaming) {
      return;
    }
    const requestKey = `${session.localId}:${environmentId}:${paths.join("|")}`;
    if (force) {
      requestedMediaKeys.current.delete(requestKey);
    }
    if (requestedMediaKeys.current.has(requestKey)) {
      return;
    }

    requestedMediaKeys.current.add(requestKey);
    setMediaBySession((current) => ({
      ...current,
      [session.localId]: {
        loading: true,
        items: force ? [] : (current[session.localId]?.items ?? []),
        progress: 35,
        stage: "Downloading generated media from the managed workspace..."
      }
    }));

    const result = await window.managedAgents.resolveEnvironmentMedia(environmentId, paths);
    setMediaBySession((current) => ({
      ...current,
      [session.localId]: result.ok
        ? {
            loading: false,
            items: result.value,
            progress: 100,
            error: result.value.length ? undefined : "No generated media file was found in the downloaded workspace."
          }
        : {
            loading: false,
            items: current[session.localId]?.items ?? [],
            progress: 0,
            error: result.error.message
          }
    }));
  }

  function resetConversation() {
    if (!selectedConversation) {
      return;
    }
    if (!window.confirm(`Delete "${selectedConversation.title}" locally?`)) {
      return;
    }
    const ids = new Set(selectedConversation.sessions.map((session) => session.localId));
    setSessions((current) => current.filter((session) => !ids.has(session.localId)));
    setCompose(initialCompose);
    setLatestRunId(null);
    setActiveConversationId(NEW_CONVERSATION_ID);
    pushStatus({ level: "success", title: "Conversation deleted locally", detail: selectedConversation.title });
  }

  function startNewConversation() {
    setActiveConversationId(NEW_CONVERSATION_ID);
    setCompose(initialCompose);
    setLatestRunId(null);
    pushStatus({ level: "info", title: "New conversation", detail: "Next message starts fresh." });
  }

  function selectConversation(conversationId: string) {
    setActiveConversationId(conversationId);
    setCompose((current) => ({
      ...current,
      previousInteractionId: "",
      autoContinue: true,
      overrideEnvironment: false,
      environmentId: ""
    }));
    setLatestRunId(null);
  }

  function deleteConversation(conversation: ConversationSummary) {
    if (!window.confirm(`Delete "${conversation.title}" locally?`)) {
      return;
    }
    const ids = new Set(conversation.sessions.map((session) => session.localId));
    setSessions((current) => current.filter((session) => !ids.has(session.localId)));
    if (activeConversationId === conversation.id) {
      setActiveConversationId(NEW_CONVERSATION_ID);
      setCompose(initialCompose);
      setLatestRunId(null);
    }
    pushStatus({ level: "success", title: "Conversation deleted locally", detail: conversation.title });
  }

  return (
    <div className="app chat-app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Bot size={16} />
          </span>
          <h1>Gemini Anything Agent</h1>
        </div>

        <div className="topbar-actions">
          <span className={`agent-status ${hasKey ? "ok" : "warn"}`}>
            <span className="status-dot" />
            {hasKey ? "Key ready" : "No key"}
          </span>
          <span className="agent-status gai-pill">
            <Sparkles size={12} />
            <code>{config.npmPackage}@{config.npmVersion}</code>
          </span>
        </div>
      </header>

      <main className={`shell chat-shell ${sidebarCollapsed ? "conversation-collapsed" : ""}`}>
        <aside
          className={`conversation-sidebar ${sidebarCollapsed ? "collapsed" : ""}`}
          aria-label="Conversations"
        >
          <div className="conversation-head">
            <h2>Conversations</h2>
            <button
              type="button"
              className="head-icon sidebar-collapse"
              title={sidebarCollapsed ? "Expand conversations" : "Collapse conversations"}
              onClick={() => setSidebarCollapsed((value) => !value)}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
            <button
              type="button"
              className="sidebar-new"
              title="New conversation"
              aria-label="New conversation"
              disabled={busy === "run" || busy === "cancel"}
              onClick={startNewConversation}
            >
              <Plus size={15} />
            </button>
          </div>

          <div className="conversation-list">
            {conversations.length === 0 ? (
              <div className="conversation-empty">No saved local conversations yet.</div>
            ) : (
              conversations.map((conversation) => (
                <div
                  className={`conversation-row ${
                    conversation.id === activeConversationId ? "active" : ""
                  }`}
                  key={conversation.id}
                >
                  <button
                    type="button"
                    className="conversation-select"
                    aria-current={conversation.id === activeConversationId ? "true" : undefined}
                    onClick={() => selectConversation(conversation.id)}
                  >
                    <MessageSquare size={14} />
                    <span>
                      <strong>{conversation.title}</strong>
                      <em>
                        {conversation.sessions.length} turn{conversation.sessions.length === 1 ? "" : "s"} ·{" "}
                        {formatConversationTime(conversation.latestAt)}
                      </em>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="conversation-delete"
                    disabled={busy === "run" || busy === "cancel"}
                    title="Delete local conversation"
                    onClick={() => deleteConversation(conversation)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

        <section className="chat-main" aria-label="Managed agent chat">
          <div className="chat-main-head">
            <span className="chat-main-title">
              {selectedConversation ? selectedConversation.title : "New conversation"}
            </span>
            {runningSession && <span className="live-dot">working…</span>}
            <span className="chat-main-head-spacer" />
            <button
              type="button"
              className="head-icon"
              title="Settings"
              aria-label="Settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings size={15} />
            </button>
            <button
              type="button"
              className="head-icon"
              title={latestEnvironmentId ? `Snapshot ${latestEnvironmentId}` : "No environment yet"}
              aria-label="Download environment snapshot"
              disabled={!latestEnvironmentId || busy !== null}
              onClick={() => latestEnvironmentId && void snapshotEnvironment(latestEnvironmentId)}
            >
              <Download size={15} />
            </button>
            <button
              type="button"
              className="head-icon danger"
              title="Delete this conversation locally"
              aria-label="Delete this conversation"
              disabled={!selectedConversation || busy !== null}
              onClick={resetConversation}
            >
              <Trash2 size={15} />
            </button>
          </div>
          <div className="chat-scroll" ref={chatScrollRef}>
            {chatSessions.length === 0 ? (
              <div className="chat-empty">
                <span className="chat-empty-mark">
                  <Bot size={28} />
                </span>
                <strong>
                  {activeConversationId === NEW_CONVERSATION_ID
                    ? "Start a new conversation"
                    : "No local turns in this conversation"}
                </strong>
                <span>
                  Session and environment continuity are on by default.
                </span>
              </div>
            ) : (
              chatSessions.map((session) => (
                <div className="conversation-turn" key={session.localId}>
                  <Transcript
                    prompt={promptForInput(session.request.input)}
                    startedAt={session.startedAt}
                    items={timelineItemsForSession(session)}
                    streaming={Boolean(session.streaming)}
                    embedded
                    empty="Waiting for the agent..."
                    onCopy={copyText}
                  />
                  <SessionMedia
                    state={mediaBySession[session.localId]}
                    onSave={saveMedia}
                    onRetry={() => void resolveMediaForSession(session, true)}
                    onOpen={setActiveMedia}
                  />
                </div>
              ))
            )}
          </div>

          <div className="chat-compose">
            <Composer
              compose={compose}
              setCompose={setCompose}
              overrideToolTypes={ALL_AGENT_TOOLS}
              autoPreviousInteractionId={autoContinuation?.seed?.id}
              autoEnvironmentId={autoEnvironment ? sessionEnvironmentId(autoEnvironment) : undefined}
              running={busy === "run"}
              locked={busy === "run" || busy === "cancel"}
              canRun={canRun}
              canCancel={Boolean(runningSession)}
              cancelDisabled={!runningSession || busy === "cancel"}
              onRun={() => void runInteraction()}
              onCancel={() => runningSession && void cancelSession(runningSession)}
            />
          </div>
        </section>
      </main>

      {settingsOpen && (
        <SettingsModal
          runtime={runtime}
          hasBridge={hasBridge}
          saving={busy === "save-key"}
          onClose={() => setSettingsOpen(false)}
          onSave={saveApiKey}
          onClear={clearApiKey}
        />
      )}

      <MediaLightbox item={activeMedia} onClose={() => setActiveMedia(null)} />

      <footer className={`status-bar ${status?.level ?? ""}`} aria-live="polite">
        {status ? (
          <div className="status-message" key={status.id}>
            {status.level === "error" ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
            <strong>{status.title}</strong>
            {status.detail && <span>{status.detail}</span>}
          </div>
        ) : (
          <span className="status-empty">
            {hasBridge
              ? `Managed agent ${agentId}`
              : "Web preview: run the Electron app for live managed-agent calls."}
          </span>
        )}
      </footer>
    </div>
  );
};
