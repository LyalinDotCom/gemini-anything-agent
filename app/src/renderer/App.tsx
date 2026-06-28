import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  AudioLines,
  Bot,
  CheckCircle2,
  Download,
  ExternalLink,
  File,
  FileText,
  FolderOpen,
  ImageIcon,
  Loader2,
  Maximize2,
  MessageSquare,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  Video,
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
  EnvironmentOutputFile,
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
import sampleCatImageUrl from "./assets/sample-prompts/cat-image.png";
import sampleCatVideoUrl from "./assets/sample-prompts/cat-video.png";
import sampleHackerNewsUrl from "./assets/sample-prompts/hacker-news-podcast.png";
import sampleHtmlAppUrl from "./assets/sample-prompts/html-app.png";
import sampleTranscriptUrl from "./assets/sample-prompts/transcript.png";
import sampleWavMp3Url from "./assets/sample-prompts/wav-mp3.png";

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
  draft?: boolean;
  running?: boolean;
};

type SessionMediaState = {
  loading: boolean;
  items: ResolvedEnvironmentMedia[];
  error?: string;
  progress?: number;
  stage?: string;
};

type EnvironmentOutputState = {
  loading: boolean;
  items: EnvironmentOutputFile[];
  error?: string;
  checked?: boolean;
};

type SamplePrompt = {
  title: string;
  detail: string;
  prompt: string;
  thumbnail: string;
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
const NEW_CONVERSATION_DRAFT: ConversationSummary = {
  id: NEW_CONVERSATION_ID,
  title: "New chat",
  sessions: [],
  latestAt: 0,
  draft: true,
  running: false
};

const SAMPLE_PROMPTS: SamplePrompt[] = [
  {
    title: "Cat Image",
    detail: "Generate a cozy still image.",
    thumbnail: sampleCatImageUrl,
    prompt: "Create a cozy square image of a cute cat playing with string in a warm Pacific Northwest home."
  },
  {
    title: "Cat Video",
    detail: "Make a short moving scene.",
    thumbnail: sampleCatVideoUrl,
    prompt:
      "Generate a short 16:9 video of a cute cat playing with a ball of yarn in a cozy Pacific Northwest living room, with pine trees visible through the windows."
  },
  {
    title: "HN Podcast",
    detail: "Research live news, then TTS.",
    thumbnail: sampleHackerNewsUrl,
    prompt:
      "Look at the live Hacker News front page and create a short recap podcast audio file that summarizes the most interesting stories."
  },
  {
    title: "WAV To MP3",
    detail: "Create audio, then convert it.",
    thumbnail: sampleWavMp3Url,
    prompt:
      "Create a 20-second spoken welcome podcast as a WAV file, then convert it to MP3 and make both files available."
  },
  {
    title: "Transcript",
    detail: "Transcribe a real episode.",
    thumbnail: sampleTranscriptUrl,
    prompt:
      "Go to https://www.gcppodcast.com/post/episode-331-2022-year-end-wrap-up/, find the podcast audio file, and transcribe it."
  },
  {
    title: "Solar HTML",
    detail: "Build one openable file.",
    thumbnail: sampleHtmlAppUrl,
    prompt:
      "Create a kid-friendly animated solar system as one self-contained HTML file. Include the Sun, all eight planets, labels, pause/play, and a speed slider."
  }
];

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

const composeFromRequest = (request: InteractionCreateRequest): ComposeState => {
  const input = typeof request.input === "string"
    ? request.input
    : request.input
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
  const parts = Array.isArray(request.input)
    ? request.input.flatMap((part, index): ImagePartDraft[] =>
        part.type === "image"
          ? [
              {
                id: uid(),
                kind: "image",
                data: part.data,
                mimeType: part.mime_type,
                name: `attached-image-${index + 1}`,
                bytes: Math.round((part.data.length * 3) / 4)
              }
            ]
          : []
      )
    : [];
  const environmentId =
    typeof request.environment === "string" && request.environment !== "remote" ? request.environment : "";

  return {
    ...initialCompose,
    inputMode: parts.length ? "parts" : "string",
    input,
    parts,
    store: request.store ?? initialCompose.store,
    autoContinue: !request.previous_interaction_id,
    reuseEnvironment: request.environment === "remote",
    background: request.background ?? initialCompose.background,
    serviceTier: request.service_tier ?? initialCompose.serviceTier,
    thinkingSummaries: request.agent_config?.thinking_summaries ?? initialCompose.thinkingSummaries,
    previousInteractionId: request.previous_interaction_id ?? "",
    overrideSystemInstruction: Boolean(request.system_instruction),
    systemInstruction: request.system_instruction ?? "",
    overrideTools: Boolean(request.tools?.length),
    overrideEnvironment: Boolean(environmentId),
    environmentId
  };
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

const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
};

const outputFileLabel = (file: EnvironmentOutputFile): string => {
  switch (file.fileType) {
    case "html":
      return "HTML";
    case "text":
      return "Text";
    case "document":
      return "Document";
    case "archive":
      return "Archive";
    case "image":
      return "Image";
    case "video":
      return "Video";
    case "audio":
      return "Audio";
    default:
      return "File";
  }
};

const outputMediaItem = (file: EnvironmentOutputFile): ResolvedEnvironmentMedia | undefined =>
  file.mediaType && file.url
    ? {
        requestedPath: file.sandboxPath,
        path: file.path,
        url: file.url,
        mediaType: file.mediaType
      }
    : undefined;

const MEDIA_PATH_PATTERN =
  /(?:\/workspace\/|workspace\/|\/tmp\/|outputs\/)[^\s`"'()[\]{}<>]+\.(?:png|jpe?g|webp|gif|avif|svg|mp4|webm|mov|m4v|wav|mp3|m4a|aac|ogg|flac)(?:[?#][^\s`"'()[\]{}<>]+)?/gi;

const cleanMediaPath = (value: string): string =>
  value.replace(/[),.;:!?]+$/g, "").replace(/[?#].*$/, "");

const TRANSCRIPT_REQUEST_PATTERN = /\b(transcrib(?:e|ed|ing)?|transcript|captions?|subtitles?|srt)\b/i;
const MEDIA_PRODUCING_REQUEST_PATTERN =
  /\b(?:image|picture|photo|video|tts|voiceover|narration|convert|mp3|generate\s+(?:an?\s+)?(?:image|video|audio)|create\s+(?:an?\s+)?(?:image|video|audio|podcast)|make\s+(?:an?\s+)?(?:image|video|audio|podcast))\b/i;

const extractMediaPaths = (text: string | undefined): string[] => {
  if (!text) {
    return [];
  }
  return [...new Set([...text.matchAll(MEDIA_PATH_PATTERN)].map((match) => cleanMediaPath(match[0])))];
};

const shouldAutoResolveMedia = (session: Session): boolean => {
  const prompt = promptForInput(session.request.input);
  const transcriptionOnly =
    TRANSCRIPT_REQUEST_PATTERN.test(prompt) && !MEDIA_PRODUCING_REQUEST_PATTERN.test(prompt);
  return !transcriptionOnly;
};

const mediaPathMatches = (item: ResolvedEnvironmentMedia, requestedPath: string): boolean => {
  const requested = cleanMediaPath(requestedPath).replace(/^[/\\]+/, "").replace(/\\/g, "/");
  const requestedWithoutWorkspace = requested.replace(/^workspace\//, "");
  const candidates = [item.requestedPath, item.path, item.savedPath]
    .filter((value): value is string => Boolean(value))
    .map((value) => cleanMediaPath(value).replace(/^[/\\]+/, "").replace(/\\/g, "/"));
  return candidates.some((candidate) => {
    const withoutWorkspace = candidate.replace(/^workspace\//, "");
    return (
      candidate === requested ||
      withoutWorkspace === requestedWithoutWorkspace ||
      candidate.endsWith(`/${requested}`) ||
      withoutWorkspace.endsWith(`/${requestedWithoutWorkspace}`)
    );
  });
};

const mediaItemsCoverPaths = (items: ResolvedEnvironmentMedia[] | undefined, paths: string[]): boolean =>
  Boolean(items?.length) && paths.every((path) => items!.some((item) => mediaPathMatches(item, path)));

const mergeResolvedMedia = (
  current: ResolvedEnvironmentMedia[] | undefined,
  incoming: ResolvedEnvironmentMedia[]
): ResolvedEnvironmentMedia[] => {
  const merged = [...(current ?? [])];
  for (const item of incoming) {
    const index = merged.findIndex(
      (candidate) =>
        candidate.requestedPath === item.requestedPath ||
        (candidate.savedPath && item.savedPath && candidate.savedPath === item.savedPath) ||
        candidate.url === item.url
    );
    if (index >= 0) {
      merged[index] = item;
    } else {
      merged.push(item);
    }
  }
  return merged;
};

const cachedMediaStateForSession = (session: Session): SessionMediaState | undefined =>
  session.resolvedMedia?.length
    ? {
        loading: false,
        items: session.resolvedMedia
      }
    : undefined;

const textFileNameForLabel = (label: string): string => {
  const stem = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "agent-output";
  return stem.endsWith(".md") || stem.endsWith(".txt") ? stem : `${stem}.md`;
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
      {state.items.map((item) => {
        const opensFromCard = item.mediaType !== "audio";
        return (
          <figure
            className={`media-card media-${item.mediaType} ${opensFromCard ? "can-open" : ""}`}
            key={`${item.requestedPath}:${item.url}`}
            onClick={(event) => {
              if (!opensFromCard) {
                return;
              }
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
                {item.mediaType === "audio" ? "Open player" : "Open"}
              </button>
              <button type="button" className="ghost-button sm" onClick={onRetry}>
                Redownload
              </button>
            </figcaption>
          </figure>
        );
      })}
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

const OutputFileIcon = ({ file }: { file: EnvironmentOutputFile }) => {
  switch (file.fileType) {
    case "image":
      return <ImageIcon size={15} />;
    case "video":
      return <Video size={15} />;
    case "audio":
      return <Music2 size={15} />;
    case "html":
    case "text":
    case "document":
      return <FileText size={15} />;
    case "archive":
      return <Archive size={15} />;
    default:
      return <File size={15} />;
  }
};

const OutputFilesPanel = ({
  state,
  environmentId,
  onRefresh,
  onSave,
  onOpen
}: {
  state: EnvironmentOutputState | undefined;
  environmentId: string | undefined;
  onRefresh: () => void;
  onSave: (file: EnvironmentOutputFile) => void;
  onOpen: (file: EnvironmentOutputFile) => void;
}) => {
  const panelState = state ?? { loading: false, items: [] };
  const canRefresh = Boolean(environmentId && !panelState.loading);

  return (
    <aside className="output-panel" aria-label="Workspace output files">
      <header className="output-panel-head">
        <span className="output-panel-title">
          <FolderOpen size={15} />
          Output
        </span>
        <button
          type="button"
          className="head-icon"
          title="Refresh output files"
          aria-label="Refresh output files"
          disabled={!canRefresh}
          onClick={onRefresh}
        >
          <RefreshCw size={14} className={panelState.loading ? "spin" : undefined} />
        </button>
      </header>
      <div className="output-panel-subtitle">/workspace/output</div>
      {panelState.error && (
        <div className="output-panel-error">
          <span>{panelState.error}</span>
          <button type="button" className="ghost-button sm" disabled={!canRefresh} onClick={onRefresh}>
            Retry
          </button>
        </div>
      )}
      {panelState.loading && (
        <div className="output-panel-loading">
          <Loader2 size={14} className="spin" />
          <span>{panelState.items.length > 0 ? "Refreshing files..." : "Checking output files..."}</span>
        </div>
      )}
      <div className="output-file-list">
        {!panelState.loading && panelState.items.length === 0 && !panelState.error && (
          <div className="output-panel-empty">
            <FolderOpen size={22} />
            <strong>{environmentId ? "No output files yet" : "No workspace yet"}</strong>
            <span>{environmentId ? "Generated artifacts will appear here." : "Start a chat to create one."}</span>
          </div>
        )}
        {panelState.items.map((file) => {
          const media = outputMediaItem(file);
          return (
            <div className="output-file-row" key={`${file.path}:${file.modifiedAt}`}>
              <span className={`output-file-icon file-${file.fileType}`}>
                <OutputFileIcon file={file} />
              </span>
              <div className="output-file-main">
                <strong title={file.sandboxPath}>{file.relativePath}</strong>
                <span>
                  {outputFileLabel(file)} · {formatFileSize(file.bytes)}
                </span>
              </div>
              <div className="output-file-actions">
                <button
                  type="button"
                  className="icon-action"
                  title={media ? "Open player" : "Open file"}
                  aria-label={media ? "Open player" : "Open file"}
                  onClick={() => onOpen(file)}
                >
                  {media ? <Maximize2 size={13} /> : <ExternalLink size={13} />}
                </button>
                <button
                  type="button"
                  className="icon-action"
                  title="Save As"
                  aria-label="Save As"
                  onClick={() => onSave(file)}
                >
                  <Download size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
};

const SessionControls = ({
  session,
  reconnecting,
  canReconnect,
  canRetry,
  canCancel,
  onReconnect,
  onRetry,
  onCancel
}: {
  session: Session;
  reconnecting: boolean;
  canReconnect: boolean;
  canRetry: boolean;
  canCancel: boolean;
  onReconnect: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) => {
  const interactionId = session.seed?.id;
  const showReconnect = Boolean(interactionId && canReconnect);
  if (reconnecting || session.streaming || (!showReconnect && !canRetry)) {
    return null;
  }

  return (
    <div className="session-controls">
      {showReconnect && (
        <button
          type="button"
          className="ghost-button sm"
          disabled={reconnecting}
          title="Reconnect to this interaction stream and refresh status"
          onClick={onReconnect}
        >
          <RefreshCw size={12} className={reconnecting ? "spin" : undefined} />
          {reconnecting ? "Reconnecting" : "Reconnect"}
        </button>
      )}
      {canRetry && (
        <button
          type="button"
          className="ghost-button sm"
          title="Restore this turn's prompt and options in the composer"
          onClick={onRetry}
        >
          <RefreshCw size={12} />
          Retry prompt
        </button>
      )}
      {session.streaming && (
        <button
          type="button"
          className="ghost-button sm danger"
          disabled={!canCancel}
          title="Cancel this remote interaction"
          onClick={onCancel}
        >
          <XCircle size={12} />
          Cancel
        </button>
      )}
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
        environmentId: [...sorted].reverse().map(sessionEnvironmentId).find((value): value is string => Boolean(value)),
        running: sorted.some((session) => session.streaming)
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

const sessionCanReconnect = (session: Session): boolean =>
  Boolean(session.seed?.id) &&
  !session.streaming &&
  (Boolean(session.error) || !interactionIsTerminal(session.seed!));

const fallbackAgent = (agentId: string): ManagedAgent => ({
  id: agentId,
  base_agent: ANTIGRAVITY_BASE_AGENT,
  description: "Preconfigured Gemini Anything managed agent."
});

const SamplePromptGallery = ({
  disabled,
  onSelect
}: {
  disabled: boolean;
  onSelect: (prompt: string) => void;
}) => (
  <div className="sample-prompts" aria-label="Sample prompts">
    <div className="sample-prompts-head">
      <AudioLines size={14} />
      <span>Sample prompts</span>
    </div>
    <div className="sample-prompt-grid">
      {SAMPLE_PROMPTS.map((sample) => (
        <button
          type="button"
          className="sample-prompt"
          disabled={disabled}
          key={sample.title}
          onClick={() => onSelect(sample.prompt)}
        >
          <img src={sample.thumbnail} alt="" aria-hidden="true" />
          <strong>{sample.title}</strong>
          <span>{sample.detail}</span>
        </button>
      ))}
    </div>
  </div>
);

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
  const [outputPanelOpen, setOutputPanelOpen] = useState(false);
  const [mediaBySession, setMediaBySession] = useState<Record<string, SessionMediaState>>({});
  const [activeMedia, setActiveMedia] = useState<ResolvedEnvironmentMedia | null>(null);
  const [outputFilesByEnvironment, setOutputFilesByEnvironment] = useState<Record<string, EnvironmentOutputState>>({});
  const [startingConversationIds, setStartingConversationIds] = useState<Record<string, boolean>>({});
  const [cancelingSessionIds, setCancelingSessionIds] = useState<Record<string, boolean>>({});
  const activeResumeIds = useRef<Set<string>>(new Set());
  const pendingRunInputs = useRef<Map<string, PendingComposeInput>>(new Map());
  const requestedMediaKeys = useRef<Set<string>>(new Set());
  const outputRefreshSignatures = useRef<Record<string, string>>({});
  const autoOpenedOutputEnvironments = useRef<Set<string>>(new Set());
  const ensureAgentPromise = useRef<Promise<EnsureAnythingAgentResult | undefined> | null>(null);
  const activeConversationIdRef = useRef(activeConversationId);
  const shouldStickToBottom = useRef(true);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const config = runtime ?? FALLBACK_RUNTIME;
  const agentId = config.agentId.trim() || FALLBACK_RUNTIME.agentId;
  const hasBridge = Boolean(window.managedAgents);
  const hasKey = Boolean(runtime?.hasApiKey);
  const runtimeLoaded = runtime !== null;
  const keyMissing = hasBridge && runtimeLoaded && !hasKey;
  const appReady = hasBridge && hasKey;
  const agentSessions = useMemo(
    () => sessions.filter((session) => session.agentId === agentId),
    [agentId, sessions]
  );
  const conversations = useMemo(
    () => buildConversations(agentSessions),
    [agentSessions]
  );
  const visibleConversations = useMemo(
    () => {
      const showDraft =
        activeConversationId === NEW_CONVERSATION_ID ||
        Boolean(startingConversationIds[NEW_CONVERSATION_ID]);
      const conversationsWithStarting = conversations.map((conversation) => ({
        ...conversation,
        running: Boolean(conversation.running || startingConversationIds[conversation.id])
      }));
      return showDraft
        ? [
            {
              ...NEW_CONVERSATION_DRAFT,
              running: Boolean(startingConversationIds[NEW_CONVERSATION_ID])
            },
            ...conversationsWithStarting
          ]
        : conversationsWithStarting;
    },
    [activeConversationId, conversations, startingConversationIds]
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
  const selectedConversationStarting = Boolean(startingConversationIds[activeConversationId]);
  const selectedConversationRunning = Boolean(runningSession || selectedConversationStarting);
  const latestEnvironmentId = selectedConversation?.environmentId;
  const activeOutputState = latestEnvironmentId ? outputFilesByEnvironment[latestEnvironmentId] : undefined;
  const activeOutputFileCount = activeOutputState?.items.length ?? 0;
  const outputPanelVisible = outputPanelOpen;
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

  const isChatNearBottom = () => {
    const node = chatScrollRef.current;
    if (!node) {
      return true;
    }
    return node.scrollHeight - node.scrollTop - node.clientHeight < 96;
  };

  const updateScrollStickiness = () => {
    shouldStickToBottom.current = isChatNearBottom();
  };

  const scrollChatToBottom = (force = false) => {
    if (!force && !shouldStickToBottom.current) {
      return;
    }
    const scroll = () => {
      const node = chatScrollRef.current;
      if (node) {
        node.scrollTop = node.scrollHeight;
        shouldStickToBottom.current = true;
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
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    writeStoredSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    shouldStickToBottom.current = true;
    scrollChatToBottom(true);
  }, [activeConversationId]);

  useEffect(() => {
    scrollChatToBottom();
  }, [chatSessions, mediaBySession, latestRunId]);

  useEffect(() => {
    if (!keyMissing) {
      return;
    }
    setSettingsOpen(true);
    setCompose(initialCompose);
    setActiveConversationId(NEW_CONVERSATION_ID);
    setLatestRunId(null);
    setStartingConversationIds({});
    setCancelingSessionIds({});
    setOutputPanelOpen(false);
    pendingRunInputs.current.clear();
    activeResumeIds.current.clear();
    requestedMediaKeys.current.clear();
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
  }, [chatSessions]);

  useEffect(() => {
    if (!latestEnvironmentId || selectedConversationRunning || !window.managedAgents?.listEnvironmentOutputFiles) {
      return;
    }
    const previousSignature = outputRefreshSignatures.current[latestEnvironmentId];
    const force = Boolean(previousSignature && previousSignature !== outputRefreshSignature);
    const state = outputFilesByEnvironment[latestEnvironmentId];
    if (!force && (state?.checked || state?.loading)) {
      return;
    }
    outputRefreshSignatures.current[latestEnvironmentId] = outputRefreshSignature;
    void loadOutputFiles(latestEnvironmentId, force);
  }, [
    latestEnvironmentId,
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

  const restorePendingRunInput = (localId: string, conversationId?: string) => {
    const snapshot = pendingRunInputs.current.get(localId);
    if (!snapshot) {
      return;
    }
    pendingRunInputs.current.delete(localId);
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
    pendingRunInputs.current.set(localId, composeInputSnapshot(compose));
    setConversationStarting(sourceConversationId, true);
    setCompose((current) => clearComposeInput(current));
    setLatestRunId(localId);

    const ensuredAgent = await ensureAgentBeforeRun(bridge, agentId);
    if (!ensuredAgent) {
      restorePendingRunInput(localId, sourceConversationId);
      setConversationStarting(sourceConversationId, false);
      return;
    }

    if (ensuredAgent.created || ensuredAgent.recreated) {
      request.environment = "remote";
    }

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
        setConversationStarting(sourceConversationId, false);
        if (startsNewConversation) {
          setActiveConversationId((current) => (current === sourceConversationId ? localId : current));
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

  async function loadOutputFiles(environmentId: string, force = false) {
    if (!window.managedAgents?.listEnvironmentOutputFiles) {
      return;
    }
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
    setOutputFilesByEnvironment((current) => ({
      ...current,
      [environmentId]: result.ok
        ? {
            loading: false,
            items: result.value,
            checked: true
          }
        : {
            loading: false,
            items: current[environmentId]?.items ?? [],
            checked: true,
            error: result.error.message
          }
    }));
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

  async function openOutputFile(file: EnvironmentOutputFile) {
    const media = outputMediaItem(file);
    if (media) {
      setActiveMedia(media);
      return;
    }
    if (!window.managedAgents?.openEnvironmentOutputFile) {
      pushStatus({ level: "error", title: "Open unavailable", detail: "Run the Electron app to open output files." });
      return;
    }
    const result = await window.managedAgents.openEnvironmentOutputFile(file.path);
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
    const paths = extractMediaPaths(mediaSearchTextForSession(session));
    if (!environmentId || paths.length === 0 || session.streaming) {
      return;
    }
    const requestKey = `${session.localId}:${environmentId}:${paths.join("|")}`;
    const cachedItems = session.resolvedMedia ?? mediaBySession[session.localId]?.items;
    if (!force && mediaItemsCoverPaths(cachedItems, paths)) {
      requestedMediaKeys.current.add(requestKey);
      setMediaBySession((current) => ({
        ...current,
        [session.localId]: {
          loading: false,
          items: cachedItems ?? [],
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
    setMediaBySession((current) => ({
      ...current,
      [session.localId]: {
        loading: true,
        items: force ? [] : (current[session.localId]?.items ?? session.resolvedMedia ?? []),
        progress: 35,
        stage: "Downloading generated media from the managed workspace..."
      }
    }));

    const result = await window.managedAgents.resolveEnvironmentMedia(environmentId, paths);
    if (result.ok && result.value.length > 0) {
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
              loading: false,
              items,
              progress: 100,
              error: result.value.length ? undefined : "No generated media file was found in the downloaded workspace."
            };
          })()
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
    if (conversationId === NEW_CONVERSATION_ID) {
      setActiveConversationId(NEW_CONVERSATION_ID);
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
    setSessions((current) => current.filter((session) => !ids.has(session.localId)));
    if (activeConversationId === conversation.id) {
      setActiveConversationId(NEW_CONVERSATION_ID);
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
      <header className="topbar">
        <div className="brand">
          <h1>Gemini Anything Agent</h1>
        </div>

        <div className="topbar-actions">
          <span className={`agent-status ${hasKey ? "ok" : "warn"}`}>
            <span className="status-dot" />
            {hasKey ? "Ready" : "Key missing"}
          </span>
          <span className="agent-status gai-pill">
            <Sparkles size={12} />
            <code>{config.npmPackage}@{config.npmVersion}</code>
          </span>
        </div>
      </header>

      <main
        className={`shell chat-shell ${sidebarCollapsed ? "conversation-collapsed" : ""} ${
          outputPanelVisible ? "has-output-panel" : ""
        }`}
      >
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
              disabled={!appReady}
              onClick={startNewConversation}
            >
              <Plus size={15} />
            </button>
          </div>

          <div className="conversation-list">
            {visibleConversations.length === 0 ? (
              <div className="conversation-empty">No saved local conversations yet.</div>
            ) : (
              visibleConversations.map((conversation) => (
                <div
                  className={`conversation-row ${conversation.draft ? "draft" : ""} ${
                    conversation.id === activeConversationId ? "active" : ""
                  } ${conversation.running ? "running" : ""}`}
                  key={conversation.id}
                >
                  <button
                    type="button"
                    className="conversation-select"
                    aria-current={conversation.id === activeConversationId ? "true" : undefined}
                    disabled={!appReady}
                    onClick={() => selectConversation(conversation.id)}
                  >
                    {conversation.running ? (
                      <Loader2 className="spin conversation-running-icon" size={14} />
                    ) : (
                      <MessageSquare size={14} />
                    )}
                    <span>
                      <strong>{conversation.title}</strong>
                      <em>
                        {conversation.draft
                          ? "Draft"
                          : `${conversation.sessions.length} turn${conversation.sessions.length === 1 ? "" : "s"} · ${formatConversationTime(conversation.latestAt)}`}
                      </em>
                    </span>
                  </button>
                  {!conversation.draft && (
                    <button
                      type="button"
                      className="conversation-delete"
                      disabled={!appReady || conversation.running}
                      title="Delete local conversation"
                      onClick={() => deleteConversation(conversation)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>

        <section className="chat-main" aria-label="Managed agent chat">
          <div className="chat-main-head">
            <span className="chat-main-title">
              {selectedConversation ? selectedConversation.title : "New chat"}
            </span>
            {selectedConversationRunning && <span className="live-dot">working…</span>}
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
              disabled={!appReady || !latestEnvironmentId || selectedConversationRunning || busy === "snapshot"}
              onClick={() => latestEnvironmentId && void snapshotEnvironment(latestEnvironmentId)}
            >
              <Download size={15} />
            </button>
            <button
              type="button"
              className="head-icon danger"
              title="Delete this conversation locally"
              aria-label="Delete this conversation"
              disabled={!appReady || !selectedConversation || selectedConversationRunning}
              onClick={resetConversation}
            >
              <Trash2 size={15} />
            </button>
          </div>
          <div className="chat-scroll" ref={chatScrollRef} onScroll={updateScrollStickiness}>
            {chatSessions.length === 0 ? (
              activeConversationId === NEW_CONVERSATION_ID ? (
                <div className="chat-empty has-samples">
                  <span className="chat-empty-mark">
                    <Bot size={28} />
                  </span>
                  <strong>Start a new chat</strong>
                  <span className="chat-empty-subtitle">Pick a sample prompt or write your own.</span>
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
                    state={mediaBySession[session.localId] ?? cachedMediaStateForSession(session)}
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
              running={selectedConversationStarting}
              locked={!appReady || selectedConversationRunning}
              canRun={canRun}
              canCancel={Boolean(runningSession)}
              cancelDisabled={!runningSession || Boolean(cancelingSessionIds[runningSession.localId])}
              onRun={() => void runInteraction()}
              onCancel={() => runningSession && void cancelSession(runningSession)}
            />
          </div>
        </section>

        <button
          type="button"
          className={`output-panel-toggle ${outputPanelOpen ? "open" : ""}`}
          title={outputPanelOpen ? "Hide output files" : "Show output files"}
          aria-label={outputPanelOpen ? "Hide output files" : "Show output files"}
          aria-pressed={outputPanelOpen}
          disabled={!appReady}
          onClick={toggleOutputPanel}
        >
          {outputPanelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          {activeOutputFileCount > 0 && <span>{activeOutputFileCount}</span>}
        </button>

        {outputPanelOpen && (
          <OutputFilesPanel
            state={activeOutputState}
            environmentId={latestEnvironmentId}
            onRefresh={() => latestEnvironmentId && void loadOutputFiles(latestEnvironmentId, true)}
            onSave={(file) => void saveOutputFile(file)}
            onOpen={(file) => void openOutputFile(file)}
          />
        )}
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
