import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Download,
  RotateCcw,
  Settings,
  Sparkles,
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
import type { InteractionStreamSnapshot, IpcError, RuntimeConfig } from "../shared/electron-api";
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
import { SettingsModal } from "./components/Overlays";

type StatusEvent = {
  id: string;
  level: "info" | "success" | "error";
  title: string;
  detail?: string;
};

type PendingComposeInput = Pick<ComposeState, "inputMode" | "input" | "parts">;

const FALLBACK_RUNTIME: RuntimeConfig = {
  hasApiKey: false,
  apiRevision: managedAgentManifest.api.apiRevision,
  baseUrl: managedAgentManifest.api.baseUrl,
  envPath: ".env",
  docsLastChecked: "2026-06-22",
  agentId: "gemini-anything-agent",
  npmPackage: "@lyalindotcom/gai",
  npmVersion: "0.1.0"
};

const ALL_AGENT_TOOLS: ToolType[] = ["code_execution", "google_search", "url_context"];

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
  const activeResumeIds = useRef<Set<string>>(new Set());
  const pendingRunInputs = useRef<Map<string, PendingComposeInput>>(new Map());
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const config = runtime ?? FALLBACK_RUNTIME;
  const agentId = config.agentId.trim() || FALLBACK_RUNTIME.agentId;
  const hasBridge = Boolean(window.managedAgents);
  const hasKey = Boolean(runtime?.hasApiKey);
  const selectedSessions = useMemo(
    () => sessions.filter((session) => session.agentId === agentId),
    [agentId, sessions]
  );
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
  const latestEnvironmentId = useMemo(
    () => selectedSessions.map(sessionEnvironmentId).find((id): id is string => Boolean(id)),
    [selectedSessions]
  );
  const canRun = hasBridge && hasKey && busy === null && hasComposeInput(compose);

  useEffect(() => {
    void loadRuntime();
  }, []);

  useEffect(() => {
    writeStoredSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    const node = chatScrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [chatSessions, latestRunId]);

  useEffect(() => {
    if (!hasBridge || !runtime?.hasApiKey || !window.managedAgents?.resumeInteractionStream) {
      return;
    }
    for (const session of selectedSessions) {
      if (shouldResumeBackgroundSession(session) && !activeResumeIds.current.has(session.localId)) {
        void resumeSessionStream(session);
      }
    }
  }, [hasBridge, runtime?.hasApiKey, selectedSessions]);

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

    const check = validateInteractionCreate(interaction);
    if (!check.ok) {
      pushStatus({ level: "error", title: "Interaction invalid", detail: check.errors.join("\n") });
      return;
    }

    const request = check.value;
    const localId = uid();
    const streamId = uid();
    const parent = selectedSessions.find((session) => session.seed?.id === request.previous_interaction_id);
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
        if (request.store === true) {
          setCompose((current) => ({ ...current, previousInteractionId: "", autoContinue: true }));
        }
      } else {
        restorePendingRunInput(localId);
        setSessions((current) => [{ ...base, error: result.error, completedAt: Date.now() }, ...current]);
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

  function resetConversation() {
    if (selectedSessions.length === 0) {
      return;
    }
    if (!window.confirm("Clear local chat history for this agent?")) {
      return;
    }
    setSessions((current) => current.filter((session) => session.agentId !== agentId));
    setCompose(initialCompose);
    setLatestRunId(null);
    pushStatus({ level: "success", title: "Conversation reset", detail: agentId });
  }

  return (
    <div className="app chat-app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Bot size={18} />
          </span>
          <div>
            <h1>Gemini Anything Agent</h1>
            <div className="brand-subline">
              <code>{agentId}</code>
            </div>
          </div>
        </div>

        <div className="topbar-actions">
          <span className={`agent-status ${hasKey ? "ok" : "warn"}`}>
            <span className="status-dot" />
            {hasKey ? "Key ready" : "No key"}
          </span>
          <span className="agent-status">
            <Sparkles size={13} />
            <code>{config.npmPackage}@{config.npmVersion}</code>
          </span>
          <button type="button" className="ghost-button" onClick={() => setSettingsOpen(true)}>
            <Settings size={14} />
            Settings
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={!latestEnvironmentId || busy !== null}
            title={latestEnvironmentId ? `Download ${latestEnvironmentId}` : "No environment yet"}
            onClick={() => latestEnvironmentId && void snapshotEnvironment(latestEnvironmentId)}
          >
            <Download size={14} />
            Snapshot
          </button>
          <button
            type="button"
            className="ghost-button danger"
            disabled={selectedSessions.length === 0 || busy !== null}
            onClick={resetConversation}
          >
            <RotateCcw size={14} />
            Reset
          </button>
        </div>
      </header>

      <main className="shell chat-shell">
        <section className="chat-main" aria-label="Managed agent chat">
          <div className="chat-scroll" ref={chatScrollRef}>
            {chatSessions.length === 0 ? (
              <div className="chat-empty">
                <Bot size={24} />
                <strong>Ready for the managed agent.</strong>
                <span>
                  Session and environment continuity are on by default.
                </span>
              </div>
            ) : (
              chatSessions.map((session) => (
                <Transcript
                  key={session.localId}
                  prompt={promptForInput(session.request.input)}
                  startedAt={session.startedAt}
                  items={timelineItemsForSession(session)}
                  streaming={Boolean(session.streaming)}
                  embedded
                  empty="Waiting for the agent..."
                  onCopy={copyText}
                />
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
