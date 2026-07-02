import { useEffect, useMemo, useRef, useState } from "react";
import { Bot } from "lucide-react";
import {
  isDeepResearchAgentId,
  validateInteractionCreate,
  type Interaction,
  type ManagedAgent
} from "@sdk";
import type {
  EnvironmentOutputFile,
  EnsureAnythingAgentResult,
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
  clearLegacyBrowserSessionHistory,
  readStoredSessions,
  writeStoredSessions
} from "./lib/sessionStore";
import {
  latestContinuableSession,
  latestReusableEnvironmentSession,
  sessionEnvironmentId,
  withAutoContinuity
} from "./lib/continuity";
import type { EnvironmentOutputState, SessionMediaState } from "./lib/mediaState";
import { createStickToBottom } from "./lib/stickToBottom";
import { readConversationOrder, writeConversationOrder } from "./lib/conversationOrder";
import {
  ALL_AGENT_TOOLS,
  buildChatInteraction,
  clearComposeInput,
  composeFromRequest,
  composeInputSnapshot,
  hasComposeInput,
  imageAttachmentsFromCompose,
  imagePartsFromRequest,
  mergeImageParts,
  promptForInput,
  restoreComposeInput,
  type PendingComposeInput
} from "./lib/interactionInput";
import {
  applyManualConversationOrder,
  buildConversations,
  NEW_CONVERSATION_ID,
  reorderConversationIds,
  visibleConversationsWithDraft,
  type ConversationSummary
} from "./lib/conversations";
import {
  cachedMediaStateForSession,
  extractMediaPaths,
  extractWorkspaceOutputPaths,
  mediaItemsCoverPaths,
  mergeResolvedMedia,
  mentionsWorkspaceOutput,
  outputMediaItemsForPaths,
  shouldAutoResolveMedia,
  textFileNameForLabel
} from "./lib/mediaResolver";
import {
  completedAtForInteraction,
  fallbackAgent,
  interactionIsTerminal,
  latestStreamEventId,
  mediaSearchTextForSession,
  mergeStreamEvents,
  patchSeedFromStreamEvent,
  patchSeedFromStreamSnapshot,
  sessionCanReconnect,
  shouldResumeBackgroundSession,
  terminalCompletedAt,
  timelineItemsForSession
} from "./lib/sessionState";
import { bridgeUnavailable, FALLBACK_RUNTIME } from "./lib/runtimeConfig";
import { outputFilesCoverPaths, outputMediaItem } from "./lib/outputFiles";
import { Composer } from "./components/Composer";
import { Transcript } from "./components/Transcript";
import { SettingsModal } from "./components/Overlays";
import { MediaLightbox, SessionMedia } from "./components/GeneratedMedia";
import { OutputFilesPanel } from "./components/OutputFilesPanel";
import { HtmlPreview } from "./components/HtmlPreview";
import { TextPreview } from "./components/TextPreview";
import { SamplePromptGallery } from "./components/SamplePromptGallery";
import { SessionControls } from "./components/SessionControls";
import { ConversationSidebar } from "./components/ConversationSidebar";
import {
  AppStatusBar,
  ChatHeader,
  OutputPanelToggle,
  TopBar,
  type StatusEvent
} from "./components/AppChrome";

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

const MEDIA_RETRY_DELAYS_MS = [1200, 2500, 5000, 9000];
const OUTPUT_RETRY_DELAYS_MS = [1200, 2500, 5000, 9000];
// Backoff for reattaching a dropped background stream before surfacing the
// error and the manual Reconnect button.
const STREAM_RECONNECT_DELAYS_MS = [2000, 5000, 12000];

export const App = () => {
  const [runtime, setRuntime] = useState<RuntimeConfig | null>(null);
  const [compose, setCompose] = useState<ComposeState>(initialCompose);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [status, setStatus] = useState<StatusEvent | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [latestRunId, setLatestRunId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string>(NEW_CONVERSATION_ID);
  const [newConversationDraftVisible, setNewConversationDraftVisible] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [conversationOrder, setConversationOrder] = useState<string[]>(readConversationOrder);
  const [outputPanelOpen, setOutputPanelOpen] = useState(true);
  const [mediaBySession, setMediaBySession] = useState<Record<string, SessionMediaState>>({});
  const [activeMedia, setActiveMedia] = useState<ResolvedEnvironmentMedia | null>(null);
  const [activeHtmlPreview, setActiveHtmlPreview] = useState<EnvironmentOutputFile | null>(null);
  const [activeTextPreview, setActiveTextPreview] = useState<EnvironmentOutputFile | null>(null);
  const [outputFilesByEnvironment, setOutputFilesByEnvironment] = useState<Record<string, EnvironmentOutputState>>({});
  const [optimisticSentImages, setOptimisticSentImages] = useState<Record<string, ImagePartDraft[]>>({});
  const [startingConversationIds, setStartingConversationIds] = useState<Record<string, boolean>>({});
  const [cancelingSessionIds, setCancelingSessionIds] = useState<Record<string, boolean>>({});
  const activeResumeIds = useRef<Set<string>>(new Set());
  const streamRetryCounts = useRef<Map<string, number>>(new Map());
  const streamRetryTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const sessionsRef = useRef<Session[]>([]);
  const pendingRunInputs = useRef<Map<string, PendingComposeInput>>(new Map());
  const requestedMediaKeys = useRef<Set<string>>(new Set());
  const completedOutputHydrationKeys = useRef<Set<string>>(new Set());
  const runtimeOutputHydrationSessionIds = useRef<Set<string>>(new Set());
  const mediaRetryCounts = useRef<Record<string, number>>({});
  const mediaRetryTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const outputRetryCounts = useRef<Record<string, number>>({});
  const outputRetryTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const outputRefreshSignatures = useRef<Record<string, string>>({});
  const outputFilesRequestSeq = useRef<Record<string, number>>({});
  const autoOpenedOutputEnvironments = useRef<Set<string>>(new Set());
  const ensureAgentPromise = useRef<Promise<EnsureAnythingAgentResult | undefined> | null>(null);
  const activeConversationIdRef = useRef(activeConversationId);
  const chatStick = useRef(createStickToBottom(true)).current;
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const config = runtime ?? FALLBACK_RUNTIME;
  const agentId = config.agentId.trim() || FALLBACK_RUNTIME.agentId;
  const hasBridge = Boolean(window.managedAgents);
  const hasKey = Boolean(runtime?.hasApiKey);
  const runtimeLoaded = runtime !== null;
  const keyMissing = hasBridge && runtimeLoaded && !hasKey;
  const appReady = hasBridge && hasKey && sessionsLoaded;
  const agentSessions = useMemo(
    () =>
      sessions.filter(
        (session) => session.agentId === agentId || isDeepResearchAgentId(session.agentId)
      ),
    [agentId, sessions]
  );
  const conversations = useMemo(
    () => applyManualConversationOrder(buildConversations(agentSessions), conversationOrder),
    [agentSessions, conversationOrder]
  );

  function reorderConversation(dragId: string, dropSlot: number) {
    // Snapshot the full current order so every conversation gets a manual
    // position from the first drag onward.
    const ids = reorderConversationIds(
      conversations.map((conversation) => conversation.id),
      dragId,
      dropSlot
    );
    setConversationOrder(ids);
    writeConversationOrder(ids);
  }
  const visibleConversations = useMemo(
    () =>
      visibleConversationsWithDraft({
        activeConversationId,
        conversations,
        draftVisible: newConversationDraftVisible,
        startingConversationIds
      }),
    [activeConversationId, conversations, newConversationDraftVisible, startingConversationIds]
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
  const sentImageParts = useMemo(
    () =>
      mergeImageParts([
        ...chatSessions.flatMap((session) => imagePartsFromRequest(session.request, session.imageAttachments)),
        ...(optimisticSentImages[activeConversationId] ?? [])
      ]),
    [activeConversationId, chatSessions, optimisticSentImages]
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
  const interaction = useMemo(
    () => withAutoContinuity(baseInteraction, selectedSessions, {
      autoContinue: compose.autoContinue,
      reuseEnvironment: compose.reuseEnvironment
    }),
    [baseInteraction, compose.autoContinue, compose.reuseEnvironment, selectedSessions]
  );
  const runningSession = useMemo(
    () => selectedSessions.find((session) => session.streaming),
    [selectedSessions]
  );
  const selectedConversationStarting = Boolean(startingConversationIds[activeConversationId]);
  const selectedConversationRunning = Boolean(runningSession || selectedConversationStarting);
  const latestEnvironmentId = selectedConversation?.environmentId;
  const activeOutputState = latestEnvironmentId ? outputFilesByEnvironment[latestEnvironmentId] : undefined;
  const activeOutputFileCount = activeOutputState?.items.length ?? 0;
  const outputPanelVisible = outputPanelOpen;
  const latestRunSession = latestRunId
    ? chatSessions.find((session) => session.localId === latestRunId)
    : undefined;
  const outputRefreshSignature = useMemo(
    () =>
      chatSessions
        .map((session) =>
          [
            session.localId,
            session.completedAt ?? "",
            session.streaming ? "streaming" : "done",
            sessionEnvironmentId(session) ?? ""
          ].join(":")
        )
        .join("|"),
    [chatSessions]
  );
  const canRun = appReady && !selectedConversationRunning && hasComposeInput(compose);

  const updateScrollStickiness = () => {
    chatStick.onScroll(chatScrollRef.current);
  };

  const handleChatWheel = (event: React.WheelEvent) => {
    chatStick.onWheel(event.deltaY);
  };

  const scrollChatToBottom = (force = false) => {
    if (force) {
      chatStick.setStuck(true);
    }
    // Late layout (images, media players) can grow content after this tick;
    // follow() re-checks stuck each time, so a user scroll between frames
    // is never overridden by these queued auto-scrolls.
    const scroll = () => chatStick.follow(chatScrollRef.current);
    scroll();
    requestAnimationFrame(() => {
      scroll();
      requestAnimationFrame(scroll);
    });
  };

  useEffect(() => {
    void loadRuntime();
  }, []);

  useEffect(() => clearAllRetryTimers, []);

  useEffect(() => {
    let canceled = false;
    clearLegacyBrowserSessionHistory();
    void readStoredSessions().then((stored) => {
      if (canceled) {
        return;
      }
      setSessions(stored.sessions);
      if (stored.ok) {
        setSessionsLoaded(true);
      } else {
        // Saving would persist the empty list and delete every chat on disk,
        // so autosave stays off for this app run when the load failed.
        console.error("Chat history failed to load; autosave is disabled to protect stored chats.");
      }
    });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    if (!sessionsLoaded) {
      return;
    }
    writeStoredSessions(sessions);
  }, [sessions, sessionsLoaded]);

  useEffect(() => {
    setActiveHtmlPreview(null);
    setActiveTextPreview(null);
    scrollChatToBottom(true);
  }, [activeConversationId]);

  useEffect(() => {
    scrollChatToBottom();
  }, [chatSessions, mediaBySession, latestRunId]);

  // A new sandbox environment means the output panel now lists different
  // files; an open preview would keep showing a file from the old one.
  const previousEnvironmentIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const previous = previousEnvironmentIdRef.current;
    previousEnvironmentIdRef.current = latestEnvironmentId;
    if (previous && latestEnvironmentId && previous !== latestEnvironmentId) {
      setActiveHtmlPreview(null);
      setActiveTextPreview(null);
    }
  }, [latestEnvironmentId]);

  // When a refresh produces a new version of the previewed file (new ?v= in
  // its url), swap the open preview to it so stale content doesn't persist.
  useEffect(() => {
    const items = latestEnvironmentId
      ? outputFilesByEnvironment[latestEnvironmentId]?.items
      : undefined;
    if (!items?.length) {
      return;
    }
    const refresh = (current: EnvironmentOutputFile | null): EnvironmentOutputFile | null => {
      if (!current) {
        return current;
      }
      const updated = items.find((item) => item.path === current.path);
      return updated && updated.url !== current.url ? updated : current;
    };
    setActiveHtmlPreview(refresh);
    setActiveTextPreview(refresh);
  }, [latestEnvironmentId, outputFilesByEnvironment]);

  useEffect(() => {
    if (!keyMissing) {
      return;
    }
    setSettingsOpen(true);
    setCompose(initialCompose);
    setActiveConversationId(NEW_CONVERSATION_ID);
    setNewConversationDraftVisible(true);
    setLatestRunId(null);
    setStartingConversationIds({});
    setCancelingSessionIds({});
    setOutputPanelOpen(true);
    setMediaBySession({});
    setOutputFilesByEnvironment({});
    setActiveHtmlPreview(null);
    setActiveTextPreview(null);
    pendingRunInputs.current.clear();
    activeResumeIds.current.clear();
    requestedMediaKeys.current.clear();
    completedOutputHydrationKeys.current.clear();
    runtimeOutputHydrationSessionIds.current.clear();
    clearAllRetryTimers();
    outputRefreshSignatures.current = {};
    autoOpenedOutputEnvironments.current.clear();
  }, [keyMissing]);

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
  }, [chatSessions, latestRunId, outputFilesByEnvironment]);

  useEffect(() => {
    for (const session of agentSessions) {
      if (!runtimeOutputHydrationSessionIds.current.has(session.localId)) {
        continue;
      }
      const environmentId = sessionEnvironmentId(session);
      if (session.streaming || !session.completedAt) {
        continue;
      }
      if (!environmentId) {
        runtimeOutputHydrationSessionIds.current.delete(session.localId);
        continue;
      }
      const outputText = mediaSearchTextForSession(session);
      const expectedOutputPaths = extractWorkspaceOutputPaths(outputText);
      const mediaPaths = extractMediaPaths(outputText);
      if (expectedOutputPaths.length === 0 && mediaPaths.length === 0) {
        runtimeOutputHydrationSessionIds.current.delete(session.localId);
        continue;
      }

      const hydrationKey = `${session.localId}:${session.completedAt}`;
      if (completedOutputHydrationKeys.current.has(hydrationKey)) {
        runtimeOutputHydrationSessionIds.current.delete(session.localId);
        continue;
      }

      completedOutputHydrationKeys.current.add(hydrationKey);
      runtimeOutputHydrationSessionIds.current.delete(session.localId);
      void loadOutputFiles(environmentId, true, { retryUntilPaths: expectedOutputPaths });
      if (mediaPaths.length > 0 && shouldAutoResolveMedia(session)) {
        void resolveMediaForSession(session, true);
      }
    }
  }, [agentSessions]);

  useEffect(() => {
    if (!latestEnvironmentId || selectedConversationRunning || !window.managedAgents?.listEnvironmentOutputFiles) {
      return;
    }
    const shouldDiscoverOutputs =
      outputPanelOpen || Boolean(latestRunSession && !latestRunSession.streaming);
    if (!shouldDiscoverOutputs) {
      return;
    }
    const previousSignature = outputRefreshSignatures.current[latestEnvironmentId];
    const completedLatestRun = Boolean(latestRunSession && latestRunSession.completedAt && !latestRunSession.streaming);
    const force = Boolean(
      completedLatestRun &&
        (!previousSignature || previousSignature !== outputRefreshSignature || !outputFilesByEnvironment[latestEnvironmentId]?.checked)
    );
    const state = outputFilesByEnvironment[latestEnvironmentId];
    if (state?.loading || (!force && state?.checked)) {
      return;
    }
    outputRefreshSignatures.current[latestEnvironmentId] = outputRefreshSignature;
    void loadOutputFiles(
      latestEnvironmentId,
      force,
      latestRunSession ? { retryUntilPaths: extractWorkspaceOutputPaths(mediaSearchTextForSession(latestRunSession)) } : undefined
    );
  }, [
    latestEnvironmentId,
    latestRunSession,
    outputPanelOpen,
    outputFilesByEnvironment,
    outputRefreshSignature,
    selectedConversationRunning
  ]);

  useEffect(() => {
    if (!latestEnvironmentId || activeOutputFileCount === 0) {
      return;
    }
    if (autoOpenedOutputEnvironments.current.has(latestEnvironmentId)) {
      return;
    }
    autoOpenedOutputEnvironments.current.add(latestEnvironmentId);
    setOutputPanelOpen(true);
  }, [activeOutputFileCount, latestEnvironmentId]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    if (!hasBridge || !runtime?.hasApiKey || !window.managedAgents?.resumeInteractionStream) {
      return;
    }
    for (const session of agentSessions) {
      if (
        shouldResumeBackgroundSession(session) &&
        !activeResumeIds.current.has(session.localId) &&
        // A pending backoff retry owns this session; resuming here would
        // bypass the backoff and hammer a flaky connection.
        !streamRetryTimers.current.has(session.localId)
      ) {
        void resumeSessionStream(session);
      }
    }
  }, [agentSessions, hasBridge, runtime?.hasApiKey]);

  const pushStatus = (event: Omit<StatusEvent, "id">) => {
    setStatus({ ...event, id: uid() });
  };

  const setConversationStarting = (conversationId: string, starting: boolean) => {
    setStartingConversationIds((current) => {
      if (starting) {
        return { ...current, [conversationId]: true };
      }
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
  };

  const setSessionCanceling = (localId: string, canceling: boolean) => {
    setCancelingSessionIds((current) => {
      if (canceling) {
        return { ...current, [localId]: true };
      }
      const next = { ...current };
      delete next[localId];
      return next;
    });
  };

  function clearMediaRetry(requestKey: string) {
    const timer = mediaRetryTimers.current[requestKey];
    if (timer) {
      clearTimeout(timer);
      delete mediaRetryTimers.current[requestKey];
    }
    delete mediaRetryCounts.current[requestKey];
  }

  function clearOutputRetry(environmentId: string) {
    const timer = outputRetryTimers.current[environmentId];
    if (timer) {
      clearTimeout(timer);
      delete outputRetryTimers.current[environmentId];
    }
    delete outputRetryCounts.current[environmentId];
  }

  function clearAllRetryTimers() {
    for (const timer of Object.values(mediaRetryTimers.current)) {
      clearTimeout(timer);
    }
    for (const timer of Object.values(outputRetryTimers.current)) {
      clearTimeout(timer);
    }
    for (const timer of streamRetryTimers.current.values()) {
      clearTimeout(timer);
    }
    mediaRetryTimers.current = {};
    mediaRetryCounts.current = {};
    outputRetryTimers.current = {};
    outputRetryCounts.current = {};
    streamRetryTimers.current.clear();
    streamRetryCounts.current.clear();
  }

  function forgetCompletedOutputHydration(sessionId: string) {
    completedOutputHydrationKeys.current = new Set(
      [...completedOutputHydrationKeys.current].filter((key) => !key.startsWith(`${sessionId}:`))
    );
  }

  function shouldRetrySessionOutputHydration(session: Session): boolean {
    if (session.streaming || !session.completedAt) {
      return false;
    }
    const outputText = mediaSearchTextForSession(session);
    return mentionsWorkspaceOutput(outputText) || extractMediaPaths(outputText).length > 0;
  }

  function scheduleMediaRetry(session: Session, requestKey: string): boolean {
    if (!shouldRetrySessionOutputHydration(session)) {
      return false;
    }
    if (mediaRetryTimers.current[requestKey]) {
      return true;
    }
    const attempt = mediaRetryCounts.current[requestKey] ?? 0;
    const delay = MEDIA_RETRY_DELAYS_MS[attempt];
    if (!delay) {
      return false;
    }

    mediaRetryCounts.current[requestKey] = attempt + 1;
    mediaRetryTimers.current[requestKey] = setTimeout(() => {
      delete mediaRetryTimers.current[requestKey];
      requestedMediaKeys.current.delete(requestKey);
      void resolveMediaForSession(session, true);
    }, delay);
    return true;
  }

  function scheduleOutputRetry(environmentId: string, expectedPaths: string[]): boolean {
    if (outputRetryTimers.current[environmentId]) {
      return true;
    }
    const attempt = outputRetryCounts.current[environmentId] ?? 0;
    const delay = OUTPUT_RETRY_DELAYS_MS[attempt];
    if (!delay) {
      return false;
    }

    outputRetryCounts.current[environmentId] = attempt + 1;
    outputRetryTimers.current[environmentId] = setTimeout(() => {
      delete outputRetryTimers.current[environmentId];
      void loadOutputFiles(environmentId, true, { retryUntilPaths: expectedPaths });
    }, delay);
    return true;
  }

  const setOptimisticSentImagesForKeys = (keys: string[], images: ImagePartDraft[]) => {
    if (images.length === 0) {
      return;
    }
    setOptimisticSentImages((current) => {
      const next = { ...current };
      for (const key of keys) {
        next[key] = mergeImageParts([...(next[key] ?? []), ...images]);
      }
      return next;
    });
  };

  const clearOptimisticSentImagesForKeys = (keys: string[]) => {
    setOptimisticSentImages((current) => {
      const next = { ...current };
      for (const key of keys) {
        delete next[key];
      }
      return next;
    });
  };

  const pruneConversationBookkeeping = (conversation: ConversationSummary) => {
    const deletedIds = new Set(conversation.sessions.map((session) => session.localId));
    const deletedEnvironmentIds = new Set(
      conversation.sessions.map(sessionEnvironmentId).filter((value): value is string => Boolean(value))
    );
    const remainingEnvironmentIds = new Set(
      sessions
        .filter((session) => !deletedIds.has(session.localId))
        .map(sessionEnvironmentId)
        .filter((value): value is string => Boolean(value))
    );

    setMediaBySession((current) =>
      Object.fromEntries(Object.entries(current).filter(([localId]) => !deletedIds.has(localId)))
    );
    setOutputFilesByEnvironment((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([environmentId]) => !deletedEnvironmentIds.has(environmentId) || remainingEnvironmentIds.has(environmentId)
        )
      )
    );

    requestedMediaKeys.current = new Set(
      [...requestedMediaKeys.current].filter((key) => {
        const [localId, environmentId] = key.split(":", 3);
        return (
          !deletedIds.has(localId) &&
          (!deletedEnvironmentIds.has(environmentId) || remainingEnvironmentIds.has(environmentId))
        );
      })
    );
    completedOutputHydrationKeys.current = new Set(
      [...completedOutputHydrationKeys.current].filter((key) => !deletedIds.has(key.split(":", 1)[0]))
    );
    for (const key of Object.keys(mediaRetryTimers.current)) {
      const [localId] = key.split(":", 1);
      if (deletedIds.has(localId)) {
        clearMediaRetry(key);
      }
    }
    for (const environmentId of deletedEnvironmentIds) {
      if (!remainingEnvironmentIds.has(environmentId)) {
        clearOutputRetry(environmentId);
      }
    }
    outputRefreshSignatures.current = Object.fromEntries(
      Object.entries(outputRefreshSignatures.current).filter(
        ([environmentId]) => !deletedEnvironmentIds.has(environmentId) || remainingEnvironmentIds.has(environmentId)
      )
    );
    for (const environmentId of deletedEnvironmentIds) {
      if (!remainingEnvironmentIds.has(environmentId)) {
        autoOpenedOutputEnvironments.current.delete(environmentId);
      }
    }
  };

  const restorePendingRunInput = (localId: string, conversationId?: string) => {
    const snapshot = pendingRunInputs.current.get(localId);
    if (!snapshot) {
      return;
    }
    pendingRunInputs.current.delete(localId);
    clearOptimisticSentImagesForKeys([localId, ...(conversationId ? [conversationId] : [])]);
    if (conversationId && activeConversationIdRef.current !== conversationId) {
      return;
    }
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
    if (ensureAgentPromise.current) {
      return ensureAgentPromise.current;
    }
    setBusy("deploy");
    ensureAgentPromise.current = (async () => {
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
    })();

    try {
      return await ensureAgentPromise.current;
    } finally {
      ensureAgentPromise.current = null;
      setBusy((current) => (current === "deploy" ? null : current));
    }
  }

  async function runInteraction() {
    if (!hasComposeInput(compose)) {
      pushStatus({ level: "error", title: "Prompt required", detail: "Type a message or attach an image." });
      return;
    }
    if (selectedConversationRunning) {
      pushStatus({
        level: "info",
        title: "Conversation is running",
        detail: "Open or create another conversation to start a parallel agent call."
      });
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

    const sourceConversationId = activeConversationId;
    const request = check.value;
    const localId = uid();
    const streamId = uid();
    const parent = selectedSessions.find((session) => session.seed?.id === request.previous_interaction_id);
    const startsNewConversation = !parent;
    const consumesNewConversationDraft =
      startsNewConversation && sourceConversationId === NEW_CONVERSATION_ID;
    const pendingImageParts = compose.parts.filter((part): part is ImagePartDraft => part.kind === "image");
    const imageAttachments = imageAttachmentsFromCompose(compose);
    pendingRunInputs.current.set(localId, composeInputSnapshot(compose));
    runtimeOutputHydrationSessionIds.current.add(localId);
    forgetCompletedOutputHydration(localId);
    setOptimisticSentImagesForKeys([sourceConversationId, localId], pendingImageParts);
    setConversationStarting(sourceConversationId, true);
    setCompose((current) => clearComposeInput(current));
    setLatestRunId(localId);

    // Deep Research agents are invoked directly by base-agent id; there is no
    // custom managed agent to deploy or snapshot for them.
    const isDeepResearchRun = isDeepResearchAgentId(request.agent);
    if (!isDeepResearchRun) {
      const ensuredAgent = await ensureAgentBeforeRun(bridge, agentId);
      if (!ensuredAgent) {
        restorePendingRunInput(localId, sourceConversationId);
        runtimeOutputHydrationSessionIds.current.delete(localId);
        setConversationStarting(sourceConversationId, false);
        return;
      }

      if (ensuredAgent.created || ensuredAgent.recreated) {
        request.environment = "remote";
        delete request.previous_interaction_id;
      }
    }

    const agentSnapshot = isDeepResearchRun
      ? fallbackAgent(request.agent)
      : await snapshotAgentForRun(request.agent, fallbackAgent(request.agent));
    const base: Session = {
      localId,
      agentId: request.agent,
      agentSnapshot,
      request,
      startedAt: Date.now(),
      imageAttachments,
      parentLocalId: parent?.localId
    };

    try {
      const createInteractionStream = bridge.createInteractionStream;
      const onInteractionStreamEvent = bridge.onInteractionStreamEvent;
      const getInteractionStreamSnapshot = bridge.getInteractionStreamSnapshot;
      const shouldCreateWithStream =
        request.background !== true &&
        createInteractionStream &&
        (onInteractionStreamEvent || getInteractionStreamSnapshot);
      if (shouldCreateWithStream) {
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
        setConversationStarting(sourceConversationId, false);
        if (consumesNewConversationDraft) {
          setNewConversationDraftVisible(false);
        }
        if (startsNewConversation) {
          setActiveConversationId((current) => (current === sourceConversationId ? localId : current));
        }
        let snapshotTimer: ReturnType<typeof setInterval> | undefined;
        // A snapshot poll in flight when the stream finishes must not apply
        // after the final update: it would flip the session back to
        // streaming:true forever and lock the conversation.
        let streamFinalized = false;
        const syncStreamSnapshot = async () => {
          if (!getInteractionStreamSnapshot || streamFinalized) {
            return;
          }
          const snapshot = await getInteractionStreamSnapshot(streamId);
          if (!snapshot.ok || streamFinalized) {
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
            streamFinalized = true;
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
          if (request.store === true && activeConversationIdRef.current === sourceConversationId) {
            setCompose((current) => ({ ...current, previousInteractionId: "", autoContinue: true }));
          }
        } else {
          restorePendingRunInput(localId, sourceConversationId);
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
        setConversationStarting(sourceConversationId, false);
        if (consumesNewConversationDraft) {
          setNewConversationDraftVisible(false);
        }
        if (startsNewConversation) {
          setActiveConversationId((current) => (current === sourceConversationId ? localId : current));
        }
        if (request.store === true && activeConversationIdRef.current === sourceConversationId) {
          setCompose((current) => ({ ...current, previousInteractionId: "", autoContinue: true }));
        }
      } else {
        restorePendingRunInput(localId, sourceConversationId);
        setSessions((current) => [{ ...base, error: result.error, completedAt: Date.now() }, ...current]);
        setConversationStarting(sourceConversationId, false);
        if (consumesNewConversationDraft) {
          setNewConversationDraftVisible(false);
        }
        if (startsNewConversation) {
          setActiveConversationId((current) => (current === sourceConversationId ? localId : current));
        }
        pushStatus({ level: "error", title: result.error.name, detail: result.error.message });
      }
    } finally {
      setConversationStarting(sourceConversationId, false);
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
    runtimeOutputHydrationSessionIds.current.add(sessionToResume.localId);
    forgetCompletedOutputHydration(sessionToResume.localId);
    setSessions((current) =>
      current.map((session) =>
        session.localId === sessionToResume.localId
          ? { ...session, error: undefined, completedAt: undefined, streaming: true, streamId }
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
    // Same guard as runInteraction: a late snapshot must not resurrect a
    // finished stream as streaming:true.
    let streamFinalized = false;
    const syncStreamSnapshot = async () => {
      if (!getInteractionStreamSnapshot || streamFinalized) {
        return;
      }
      const snapshot = await getInteractionStreamSnapshot(streamId);
      if (!snapshot.ok || streamFinalized) {
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
          streamFinalized = true;
          unsubscribe();
        }
      })();

      if (result.ok) {
        streamRetryCounts.current.delete(sessionToResume.localId);
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
      } else if (scheduleStreamReconnect(sessionToResume)) {
        // The interaction keeps running server-side across a dropped stream;
        // retry the resume quietly before surfacing an error.
        setSessions((current) =>
          current.map((session) =>
            session.localId === sessionToResume.localId
              ? { ...session, streaming: false, streamId: undefined }
              : session
          )
        );
      } else {
        streamRetryCounts.current.delete(sessionToResume.localId);
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

  /**
   * Schedules a bounded backoff retry of the stream resume for a background
   * session. Returns false once attempts are exhausted (or the session isn't
   * eligible), letting the caller surface the error and the Reconnect button.
   */
  function scheduleStreamReconnect(sessionToResume: Session): boolean {
    const localId = sessionToResume.localId;
    if (
      sessionToResume.request.background !== true ||
      sessionToResume.request.store !== true ||
      streamRetryTimers.current.has(localId)
    ) {
      return false;
    }
    const attempt = (streamRetryCounts.current.get(localId) ?? 0) + 1;
    if (attempt > STREAM_RECONNECT_DELAYS_MS.length) {
      return false;
    }
    streamRetryCounts.current.set(localId, attempt);
    pushStatus({
      level: "info",
      title: "Stream disconnected",
      detail: `Reconnecting (attempt ${attempt}/${STREAM_RECONNECT_DELAYS_MS.length})…`
    });
    const timer = setTimeout(() => {
      streamRetryTimers.current.delete(localId);
      const latest = sessionsRef.current.find((session) => session.localId === localId);
      if (latest && shouldResumeBackgroundSession(latest) && !activeResumeIds.current.has(localId)) {
        void resumeSessionStream(latest);
      }
    }, STREAM_RECONNECT_DELAYS_MS[attempt - 1]);
    streamRetryTimers.current.set(localId, timer);
    return true;
  }

  async function reconnectSessionStream(sessionToReconnect: Session) {
    if (!window.managedAgents?.resumeInteractionStream) {
      pushStatus({ level: "error", title: "Reconnect unavailable", detail: "Run the Electron app to reconnect streams." });
      return;
    }
    const interactionId = sessionToReconnect.seed?.id;
    if (!interactionId) {
      pushStatus({ level: "error", title: "Reconnect unavailable", detail: "This turn has no interaction id yet." });
      return;
    }
    if (activeResumeIds.current.has(sessionToReconnect.localId)) {
      return;
    }

    const staleStreamId = sessionToReconnect.streamId;
    if (staleStreamId && window.managedAgents.cancelInteractionStream) {
      await window.managedAgents.cancelInteractionStream(staleStreamId);
    }

    // A manual reconnect starts a fresh automatic-retry budget.
    streamRetryCounts.current.delete(sessionToReconnect.localId);
    pushStatus({ level: "info", title: "Reconnecting", detail: interactionId });
    await resumeSessionStream({
      ...sessionToReconnect,
      error: undefined,
      completedAt: undefined,
      streamId: undefined,
      streaming: false
    });
  }

  function restoreSessionPromptForRetry(sessionToRetry: Session) {
    setCompose(composeFromRequest(sessionToRetry.request));
    setLatestRunId(null);
    pushStatus({
      level: "info",
      title: "Prompt restored",
      detail: "Press Run to retry this turn."
    });
  }

  async function cancelSession(sessionToCancel: Session) {
    if (!window.managedAgents) {
      pushStatus({ level: "error", title: bridgeUnavailable.name, detail: bridgeUnavailable.message });
      return;
    }
    if (cancelingSessionIds[sessionToCancel.localId]) {
      return;
    }
    const interactionId = sessionToCancel.seed?.id;
    const streamId = sessionToCancel.streamId;
    if (!interactionId && !streamId) {
      pushStatus({ level: "error", title: "Cancel unavailable", detail: "This run has no active interaction id." });
      return;
    }

    setSessionCanceling(sessionToCancel.localId, true);
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
      setSessionCanceling(sessionToCancel.localId, false);
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

  async function setSpecializedToolsEnabled(enabled: boolean) {
    if (!window.managedAgents?.setSpecializedToolsEnabled) {
      pushStatus({ level: "error", title: bridgeUnavailable.name, detail: bridgeUnavailable.message });
      return;
    }
    setBusy("save-tools");
    try {
      const result = await window.managedAgents.setSpecializedToolsEnabled(enabled);
      if (!result.ok) {
        pushStatus({ level: "error", title: result.error.name, detail: result.error.message });
        return;
      }
      await loadRuntime();
      pushStatus({
        level: "success",
        title: enabled ? "Specialized tools enabled" : "Plain agent mode enabled",
        detail: enabled
          ? "Next run will deploy the media skill, gai CLI, and sandbox env."
          : "Next run will deploy without the media skill, gai CLI, or sandbox env."
      });
    } finally {
      setBusy(null);
    }
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      pushStatus({ level: "success", title: label, detail: "Copied to clipboard" });
    } catch {
      pushStatus({ level: "error", title: "Copy failed", detail: "Clipboard unavailable" });
    }
  }

  async function saveText(text: string, label: string) {
    if (!window.managedAgents?.saveText) {
      pushStatus({ level: "error", title: "Save unavailable", detail: "Run the Electron app to save text." });
      return;
    }
    const result = await window.managedAgents.saveText(text, textFileNameForLabel(label));
    if (!result.ok) {
      pushStatus({ level: "error", title: result.error.name, detail: result.error.message });
      return;
    }
    if (result.value.saved) {
      pushStatus({ level: "success", title: "Text saved", detail: result.value.path });
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

  function mediaStateForSession(session: Session): SessionMediaState | undefined {
    if (!shouldAutoResolveMedia(session)) {
      return undefined;
    }
    const runtimeState = mediaBySession[session.localId];
    const persistedState = cachedMediaStateForSession(session);
    if (session.streaming) {
      return runtimeState ?? persistedState;
    }

    const environmentId = sessionEnvironmentId(session);
    const outputState = environmentId ? outputFilesByEnvironment[environmentId] : undefined;
    const paths = extractMediaPaths(mediaSearchTextForSession(session));
    const outputItems = outputMediaItemsForPaths(outputState?.items, paths);
    const mergedItems = mergeResolvedMedia(
      mergeResolvedMedia(persistedState?.items, outputItems),
      runtimeState?.items ?? []
    );

    if (mergedItems.length > 0) {
      return {
        loading: false,
        items: mergedItems,
        progress: 100
      };
    }

    if (runtimeState?.loading && !session.streaming && session.localId !== latestRunId) {
      return persistedState;
    }

    return runtimeState ?? persistedState;
  }

  async function loadOutputFiles(
    environmentId: string,
    force = false,
    options: { retryUntilPaths?: string[] } = {}
  ): Promise<EnvironmentOutputFile[] | undefined> {
    if (!window.managedAgents?.listEnvironmentOutputFiles) {
      return undefined;
    }
    // Refresh button, auto-refresh, and retry timers can overlap; only the
    // newest request per environment may write state, or a slow stale
    // response would overwrite a fresher file list.
    const requestId = (outputFilesRequestSeq.current[environmentId] ?? 0) + 1;
    outputFilesRequestSeq.current[environmentId] = requestId;
    setOutputFilesByEnvironment((current) => ({
      ...current,
      [environmentId]: {
        loading: true,
        items: current[environmentId]?.items ?? [],
        checked: current[environmentId]?.checked,
        error: undefined
      }
    }));

    const result = await window.managedAgents.listEnvironmentOutputFiles(environmentId, force);
    if (outputFilesRequestSeq.current[environmentId] !== requestId) {
      return undefined;
    }
    let nextItems: EnvironmentOutputFile[] | undefined;
    let retryScheduled = false;
    setOutputFilesByEnvironment((current) => ({
      ...current,
      [environmentId]: result.ok
        ? (() => {
            const previousItems = current[environmentId]?.items ?? [];
            const expectedPaths = options.retryUntilPaths ?? [];
            nextItems = result.value.length > 0 ? result.value : previousItems;
            const missingExpectedPaths =
              expectedPaths.length > 0 && !outputFilesCoverPaths(nextItems, expectedPaths);
            retryScheduled = missingExpectedPaths
              ? scheduleOutputRetry(environmentId, expectedPaths)
              : false;
            if (!missingExpectedPaths) {
              clearOutputRetry(environmentId);
            }
            return {
              loading: retryScheduled,
              items: nextItems,
              checked: !retryScheduled,
              error: undefined
            };
          })()
        : (() => {
            const previousItems = current[environmentId]?.items ?? [];
            const expectedPaths = options.retryUntilPaths ?? [];
            const retryAfterError =
              expectedPaths.length > 0 && !outputFilesCoverPaths(previousItems, expectedPaths);
            retryScheduled = retryAfterError
              ? scheduleOutputRetry(environmentId, expectedPaths)
              : false;
            nextItems = previousItems;
            return {
              loading: retryScheduled,
              items: previousItems,
              checked: !retryScheduled,
              error: retryScheduled || previousItems.length ? undefined : result.error.message
            };
          })()
    }));
    return nextItems;
  }

  async function saveOutputFile(file: EnvironmentOutputFile) {
    if (!window.managedAgents?.saveEnvironmentOutputFile) {
      pushStatus({ level: "error", title: "Save unavailable", detail: "Run the Electron app to save output files." });
      return;
    }
    const result = await window.managedAgents.saveEnvironmentOutputFile(file.path);
    if (!result.ok) {
      pushStatus({ level: "error", title: result.error.name, detail: result.error.message });
      return;
    }
    if (result.value.saved) {
      pushStatus({ level: "success", title: "File saved", detail: result.value.path });
    }
  }

  function openLinkedOutputFile(url: string) {
    const items = latestEnvironmentId
      ? outputFilesByEnvironment[latestEnvironmentId]?.items
      : undefined;
    if (!items?.length) {
      return;
    }
    // Resolve a gemini-media:// URL (as clicked inside a preview) back to the
    // output file it serves; ?v= cache-busting on listed urls is ignored.
    const normalize = (value: string): string | undefined => {
      try {
        const parsed = new URL(value);
        if (parsed.protocol !== "gemini-media:") {
          return undefined;
        }
        return `${parsed.hostname}${decodeURIComponent(parsed.pathname)}`;
      } catch {
        return undefined;
      }
    };
    const target = normalize(url);
    if (!target) {
      return;
    }
    const file = items.find((item) => item.url && normalize(item.url) === target);
    if (file) {
      previewOutputFile(file);
    }
  }

  function previewOutputFile(file: EnvironmentOutputFile) {
    const media = outputMediaItem(file);
    if (media) {
      setActiveMedia(media);
      return;
    }
    if (file.fileType === "html" && file.url) {
      setActiveTextPreview(null);
      setActiveHtmlPreview(file);
      return;
    }
    if ((file.fileType === "markdown" || file.fileType === "text") && file.url) {
      setActiveHtmlPreview(null);
      setActiveTextPreview(file);
      return;
    }
    void openOutputFileExternally(file);
  }

  async function openOutputFileExternally(file: EnvironmentOutputFile) {
    if (!window.managedAgents?.openEnvironmentOutputFile) {
      pushStatus({ level: "error", title: "Open unavailable", detail: "Run the Electron app to open output files." });
      return;
    }
    const result = await window.managedAgents.openEnvironmentOutputFile(file.path);
    if (!result.ok) {
      pushStatus({ level: "error", title: result.error.name, detail: result.error.message });
    }
  }

  async function openPreviewLinkExternally(url: string) {
    if (!window.managedAgents?.openExternal) {
      pushStatus({ level: "error", title: "Open link unavailable", detail: "Run the Electron app to open links." });
      return;
    }
    const result = await window.managedAgents.openExternal(url);
    if (!result.ok) {
      pushStatus({ level: "error", title: result.error.name, detail: result.error.message });
    }
  }

  async function resolveMediaForSession(session: Session, force = false) {
    if (!window.managedAgents?.resolveEnvironmentMedia) {
      return;
    }
    if (!force && !shouldAutoResolveMedia(session)) {
      return;
    }
    const environmentId = sessionEnvironmentId(session);
    if (!environmentId || session.streaming) {
      return;
    }
    const paths = extractMediaPaths(mediaSearchTextForSession(session));
    if (paths.length === 0) {
      return;
    }
    const requestKey = `${session.localId}:${environmentId}:${paths.join("|")}`;
    const runtimeItems = mediaBySession[session.localId]?.items;
    const persistedItems = session.resolvedMedia;
    const cachedItems = runtimeItems ?? persistedItems;
    const outputItems = outputMediaItemsForPaths(outputFilesByEnvironment[environmentId]?.items, paths);
    if (!force && outputItems.length > 0) {
      requestedMediaKeys.current.add(requestKey);
      clearMediaRetry(requestKey);
      const items = mergeResolvedMedia(cachedItems, outputItems);
      setMediaBySession((current) => ({
        ...current,
        [session.localId]: {
          loading: false,
          items,
          progress: 100
        }
      }));
      if (!mediaItemsCoverPaths(session.resolvedMedia, paths)) {
        setSessions((current) =>
          current.map((currentSession) =>
            currentSession.localId === session.localId
              ? {
                  ...currentSession,
                  resolvedMedia: mergeResolvedMedia(currentSession.resolvedMedia, outputItems)
                }
              : currentSession
          )
        );
      }
      return;
    }
    if (!force && mediaItemsCoverPaths(runtimeItems, paths)) {
      requestedMediaKeys.current.add(requestKey);
      clearMediaRetry(requestKey);
      setMediaBySession((current) => ({
        ...current,
        [session.localId]: {
          loading: false,
          items: runtimeItems ?? [],
          progress: 100
        }
      }));
      return;
    }
    if (force) {
      requestedMediaKeys.current.delete(requestKey);
    }
    if (requestedMediaKeys.current.has(requestKey)) {
      return;
    }

    requestedMediaKeys.current.add(requestKey);
    const existingItems = cachedItems ?? [];
    const showInlineLoading = existingItems.length === 0 && (force || session.streaming || session.localId === latestRunId);
    setMediaBySession((current) => ({
      ...current,
      [session.localId]: {
        loading: showInlineLoading,
        items: force ? existingItems : (current[session.localId]?.items ?? existingItems),
        progress: showInlineLoading ? 35 : 100,
        stage: showInlineLoading ? "Downloading generated media from the managed workspace..." : undefined
      }
    }));

    const result = await window.managedAgents.resolveEnvironmentMedia(environmentId, paths);
    const retryScheduled = result.ok
      ? result.value.length === 0 && scheduleMediaRetry(session, requestKey)
      : scheduleMediaRetry(session, requestKey);
    if (result.ok && result.value.length > 0) {
      clearMediaRetry(requestKey);
      setSessions((current) =>
        current.map((currentSession) =>
          currentSession.localId === session.localId
            ? {
                ...currentSession,
                resolvedMedia: mergeResolvedMedia(currentSession.resolvedMedia, result.value)
              }
            : currentSession
        )
      );
    }
    setMediaBySession((current) => ({
      ...current,
      [session.localId]: result.ok
        ? (() => {
            const items = mergeResolvedMedia(current[session.localId]?.items ?? session.resolvedMedia, result.value);
            return {
              loading: retryScheduled && items.length === 0,
              items,
              progress: retryScheduled ? 65 : 100,
              stage: retryScheduled ? "Waiting for generated media to appear in the workspace..." : undefined,
              error: result.value.length || retryScheduled
                ? undefined
                : "No generated media file was found in the downloaded workspace."
            };
          })()
        : {
            loading: retryScheduled && !(current[session.localId]?.items ?? session.resolvedMedia ?? []).length,
            items: current[session.localId]?.items ?? session.resolvedMedia ?? [],
            progress: retryScheduled ? 65 : (current[session.localId]?.items ?? session.resolvedMedia ?? []).length ? 100 : 0,
            stage: retryScheduled ? "Waiting for generated media to appear in the workspace..." : undefined,
            error: retryScheduled || (current[session.localId]?.items ?? session.resolvedMedia ?? []).length
              ? undefined
              : result.error.message
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
    pruneConversationBookkeeping(selectedConversation);
    setSessions((current) => current.filter((session) => !ids.has(session.localId)));
    clearOptimisticSentImagesForKeys([selectedConversation.id, NEW_CONVERSATION_ID]);
    setCompose(initialCompose);
    setLatestRunId(null);
    setActiveConversationId(NEW_CONVERSATION_ID);
    setNewConversationDraftVisible(true);
    pushStatus({ level: "success", title: "Conversation deleted locally", detail: selectedConversation.title });
  }

  function startNewConversation() {
    setActiveConversationId(NEW_CONVERSATION_ID);
    setNewConversationDraftVisible(true);
    clearOptimisticSentImagesForKeys([NEW_CONVERSATION_ID]);
    setCompose(initialCompose);
    setLatestRunId(null);
    pushStatus({ level: "info", title: "New conversation", detail: "Next message starts fresh." });
  }

  function selectConversation(conversationId: string) {
    if (conversationId === NEW_CONVERSATION_ID) {
      setActiveConversationId(NEW_CONVERSATION_ID);
      setNewConversationDraftVisible(true);
      setLatestRunId(null);
      return;
    }
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
    pruneConversationBookkeeping(conversation);
    setSessions((current) => current.filter((session) => !ids.has(session.localId)));
    clearOptimisticSentImagesForKeys([conversation.id]);
    if (activeConversationId === conversation.id) {
      setActiveConversationId(NEW_CONVERSATION_ID);
      setNewConversationDraftVisible(true);
      clearOptimisticSentImagesForKeys([NEW_CONVERSATION_ID]);
      setCompose(initialCompose);
      setLatestRunId(null);
    }
    pushStatus({ level: "success", title: "Conversation deleted locally", detail: conversation.title });
  }

  function loadSamplePrompt(prompt: string) {
    setCompose((current) => ({
      ...current,
      inputMode: "string",
      input: prompt,
      parts: []
    }));
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>(".chat-compose textarea")?.focus();
    });
  }

  function toggleOutputPanel() {
    const opening = !outputPanelOpen;
    setOutputPanelOpen(opening);
    if (
      opening &&
      latestEnvironmentId &&
      !activeOutputState?.checked &&
      !activeOutputState?.loading &&
      window.managedAgents?.listEnvironmentOutputFiles
    ) {
      void loadOutputFiles(latestEnvironmentId);
    }
  }

  return (
    <div className="app chat-app">
      <TopBar hasKey={hasKey} />

      <main
        className={`shell chat-shell ${sidebarCollapsed ? "conversation-collapsed" : ""} ${
          outputPanelVisible ? "has-output-panel" : ""
        }`}
      >
        <ConversationSidebar
          collapsed={sidebarCollapsed}
          appReady={appReady}
          activeConversationId={activeConversationId}
          conversations={visibleConversations}
          onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
          onNewConversation={startNewConversation}
          onSelectConversation={selectConversation}
          onDeleteConversation={deleteConversation}
          onReorderConversation={reorderConversation}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <section
          className={`chat-main ${activeHtmlPreview?.url || activeTextPreview?.url ? "previewing-output" : ""}`}
          aria-label="Managed agent chat"
        >
          <ChatHeader
            title={selectedConversation ? selectedConversation.title : "New chat"}
            running={selectedConversationRunning}
            appReady={appReady}
            environmentId={latestEnvironmentId}
            snapshotting={busy === "snapshot"}
            canDelete={Boolean(selectedConversation)}
            onSnapshot={() => latestEnvironmentId && void snapshotEnvironment(latestEnvironmentId)}
            onDelete={resetConversation}
          />
          {activeHtmlPreview?.url ? (
            <HtmlPreview
              file={activeHtmlPreview}
              onClose={() => setActiveHtmlPreview(null)}
              onOpenExternal={(url) => void openPreviewLinkExternally(url)}
              onOpenLinkedFile={openLinkedOutputFile}
            />
          ) : activeTextPreview?.url ? (
            <TextPreview
              file={activeTextPreview}
              onClose={() => setActiveTextPreview(null)}
              onOpenExternal={(url) => void openPreviewLinkExternally(url)}
              onOpenLinkedFile={openLinkedOutputFile}
            />
          ) : (
            <>
              <div
                className="chat-scroll"
                ref={chatScrollRef}
                onScroll={updateScrollStickiness}
                onWheel={handleChatWheel}
              >
                {chatSessions.length === 0 ? (
                  activeConversationId === NEW_CONVERSATION_ID ? (
                    compose.agentMode === "anything" ? (
                      <div className="chat-empty has-samples">
                        <SamplePromptGallery
                          disabled={!appReady || selectedConversationRunning}
                          onSelect={loadSamplePrompt}
                        />
                      </div>
                    ) : (
                      <div className="chat-empty">
                        <span className="chat-empty-mark">
                          <Bot size={28} />
                        </span>
                        <strong>Deep Research</strong>
                        <span className="chat-empty-subtitle">
                          Ask a research question. Runs happen in the background and can take up
                          to 60 minutes.
                        </span>
                      </div>
                    )
                  ) : (
                    <div className="chat-empty">
                      <span className="chat-empty-mark">
                        <Bot size={28} />
                      </span>
                      <strong>No local turns in this conversation</strong>
                      <span className="chat-empty-subtitle">
                        Session and environment continuity are on by default.
                      </span>
                    </div>
                  )
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
                        onSaveText={saveText}
                      />
                      <SessionControls
                        session={session}
                        reconnecting={activeResumeIds.current.has(session.localId)}
                        canReconnect={Boolean(
                          appReady &&
                            window.managedAgents?.resumeInteractionStream &&
                            sessionCanReconnect(session) &&
                            !activeResumeIds.current.has(session.localId)
                        )}
                        canRetry={Boolean(appReady && session.error && !selectedConversationRunning)}
                        canCancel={Boolean(
                          session.streaming &&
                            !cancelingSessionIds[session.localId] &&
                            (session.seed?.id || session.streamId)
                        )}
                        onReconnect={() => void reconnectSessionStream(session)}
                        onRetry={() => restoreSessionPromptForRetry(session)}
                        onCancel={() => void cancelSession(session)}
                      />
                      <SessionMedia
                        state={mediaStateForSession(session)}
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
                  sentImageParts={sentImageParts}
                  running={selectedConversationStarting}
                  locked={!appReady || selectedConversationRunning}
                  canRun={canRun}
                  canCancel={Boolean(runningSession)}
                  cancelDisabled={!runningSession || Boolean(cancelingSessionIds[runningSession.localId])}
                  onRun={() => void runInteraction()}
                  onCancel={() => runningSession && void cancelSession(runningSession)}
                  onAttachmentError={(message) => pushStatus({ level: "error", title: "Attachment failed", detail: message })}
                />
              </div>
            </>
          )}
        </section>

        {!outputPanelOpen && (
          <OutputPanelToggle
            fileCount={activeOutputFileCount}
            appReady={appReady}
            onClick={toggleOutputPanel}
          />
        )}

        {outputPanelOpen && (
          <OutputFilesPanel
            state={activeOutputState}
            environmentId={latestEnvironmentId}
            onRefresh={() => latestEnvironmentId && void loadOutputFiles(latestEnvironmentId, true)}
            onSave={(file) => void saveOutputFile(file)}
            onPreview={previewOutputFile}
            onOpenExternal={(file) => void openOutputFileExternally(file)}
            onClose={() => setOutputPanelOpen(false)}
          />
        )}
      </main>

      {settingsOpen && (
        <SettingsModal
          runtime={runtime}
          hasBridge={hasBridge}
          saving={busy === "save-key"}
          savingSpecializedTools={busy === "save-tools"}
          onClose={() => setSettingsOpen(false)}
          onSave={saveApiKey}
          onClear={clearApiKey}
          onSetSpecializedToolsEnabled={(enabled) => void setSpecializedToolsEnabled(enabled)}
        />
      )}

      <MediaLightbox item={activeMedia} onClose={() => setActiveMedia(null)} />

      <AppStatusBar status={status} hasBridge={hasBridge} agentId={agentId} />
    </div>
  );
};
