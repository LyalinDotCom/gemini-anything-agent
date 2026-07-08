import type {
  AgentDefinition,
  AgentListResponse,
  Interaction,
  InteractionCreateRequest,
  InteractionStreamEvent,
  ManagedAgent
} from "../sdk";

export type RuntimeConfig = {
  hasApiKey: boolean;
  /** Masked preview of the configured key, e.g. "AIza••••••wxyz". Never the full key. */
  apiKeyMasked?: string;
  apiRevision: string;
  baseUrl: string;
  /** Absolute path of the .env file the key is written to. */
  envPath: string;
  /** Absolute path where chat folders and diagnostic logs are written. */
  chatStorePath: string;
  docsLastChecked: string;
  agentId: string;
  npmPackage: string;
  npmVersion: string;
};

export type SetApiKeyResult = {
  hasApiKey: boolean;
  apiKeyMasked?: string;
  envPath: string;
};

export type EnsureAnythingAgentResult = {
  agent: ManagedAgent;
  created: boolean;
  recreated?: boolean;
  sourceTargets: string[];
};

export type SnapshotDownloadResult =
  | { saved: true; path: string; bytes: number }
  | { saved: false; canceled: true };

export type ResolvedEnvironmentMedia = {
  requestedPath: string;
  path: string;
  savedPath?: string;
  url: string;
  mediaType: "image" | "video" | "audio";
};

export type EnvironmentOutputFile = {
  sandboxPath: string;
  relativePath: string;
  name: string;
  path: string;
  bytes: number;
  modifiedAt: number;
  fileType: "image" | "video" | "audio" | "html" | "markdown" | "text" | "document" | "archive" | "other";
  mediaType?: ResolvedEnvironmentMedia["mediaType"];
  url?: string;
};

export type SaveResolvedMediaResult =
  | { saved: true; path: string; bytes: number }
  | { saved: false; canceled: true };

export type SaveTextResult =
  | { saved: true; path: string; bytes: number }
  | { saved: false; canceled: true };

export type ReadEnvironmentOutputTextResult = {
  path: string;
  content: string;
  bytes: number;
  fileType: "html" | "markdown" | "text";
};

export type InteractionStreamSnapshot = {
  events: InteractionStreamEvent[];
  latestInteraction?: Interaction;
  done: boolean;
  lastEventId?: string;
};

export type IpcError = {
  name: string;
  message: string;
  status?: number;
  errors?: string[];
  details?: unknown;
};

export type PersistedImageAttachment = {
  id: string;
  name: string;
  path?: string;
  bytes: number;
  mimeType: string;
};

export type PersistedSession = {
  localId: string;
  agentId: string;
  agentSnapshot?: ManagedAgent;
  request: InteractionCreateRequest;
  seed?: Interaction;
  events?: InteractionStreamEvent[];
  streaming?: boolean;
  streamId?: string;
  startedAt: number;
  completedAt?: number;
  error?: IpcError;
  imageAttachments?: PersistedImageAttachment[];
  parentLocalId?: string;
};

export type ChatSessionStoreSnapshot = {
  rootPath: string;
  sessions: PersistedSession[];
};

export type IpcResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: IpcError;
    };

export type ManagedAgentsBridge = {
  getRuntimeConfig: () => Promise<IpcResult<RuntimeConfig>>;
  setApiKey: (key: string) => Promise<IpcResult<SetApiKeyResult>>;
  ensureAnythingAgent: (agentId?: string) => Promise<IpcResult<EnsureAnythingAgentResult>>;
  createAgent: (agent: AgentDefinition) => Promise<IpcResult<ManagedAgent>>;
  listAgents: () => Promise<IpcResult<AgentListResponse>>;
  getAgent: (id: string) => Promise<IpcResult<ManagedAgent>>;
  deleteAgent: (id: string) => Promise<IpcResult<boolean>>;
  createInteraction: (request: InteractionCreateRequest) => Promise<IpcResult<Interaction>>;
  createInteractionStream?: (
    streamId: string,
    request: InteractionCreateRequest
  ) => Promise<IpcResult<Interaction>>;
  resumeInteractionStream?: (
    streamId: string,
    interactionId: string,
    lastEventId?: string
  ) => Promise<IpcResult<Interaction>>;
  cancelInteractionStream?: (streamId: string) => Promise<IpcResult<boolean>>;
  getInteractionStreamSnapshot?: (
    streamId: string
  ) => Promise<IpcResult<InteractionStreamSnapshot>>;
  onInteractionStreamEvent?: (
    streamId: string,
    callback: (event: InteractionStreamEvent) => void
  ) => () => void;
  getInteraction: (id: string) => Promise<IpcResult<Interaction>>;
  cancelInteraction: (id: string) => Promise<IpcResult<Interaction>>;
  deleteInteraction: (id: string) => Promise<IpcResult<boolean>>;
  downloadEnvironmentSnapshot: (environmentId: string) => Promise<IpcResult<SnapshotDownloadResult>>;
  listEnvironmentOutputFiles?: (
    environmentId: string,
    force?: boolean
  ) => Promise<IpcResult<EnvironmentOutputFile[]>>;
  saveEnvironmentOutputFile?: (path: string) => Promise<IpcResult<SaveResolvedMediaResult>>;
  openEnvironmentOutputFile?: (path: string) => Promise<IpcResult<boolean>>;
  readEnvironmentOutputText?: (path: string) => Promise<IpcResult<ReadEnvironmentOutputTextResult>>;
  saveText: (content: string, defaultFileName?: string) => Promise<IpcResult<SaveTextResult>>;
  loadStoredSessions: () => Promise<IpcResult<ChatSessionStoreSnapshot>>;
  saveStoredSessions: (sessions: PersistedSession[]) => Promise<IpcResult<ChatSessionStoreSnapshot>>;
  /** Blocking save used on window unload, when an async IPC round-trip may not complete. */
  saveStoredSessionsSync?: (sessions: PersistedSession[]) => boolean;
  /** Fire-and-forget runtime diagnostics appended to the conversation's folder. */
  appendConversationDiagnostics?: (
    conversationId: string,
    entry: { at: string; event: string; detail?: string }
  ) => void;
  getPathForFile?: (file: File) => string;
  openExternal: (url: string) => Promise<IpcResult<boolean>>;
};

export const ipcChannels = {
  runtimeConfig: "managed-agents:runtime-config",
  setApiKey: "managed-agents:set-api-key",
  ensureAnythingAgent: "managed-agents:ensure-anything-agent",
  createAgent: "managed-agents:create-agent",
  listAgents: "managed-agents:list-agents",
  getAgent: "managed-agents:get-agent",
  deleteAgent: "managed-agents:delete-agent",
  createInteraction: "managed-agents:create-interaction",
  createInteractionStream: "managed-agents:create-interaction-stream",
  resumeInteractionStream: "managed-agents:resume-interaction-stream",
  cancelInteractionStream: "managed-agents:cancel-interaction-stream",
  getInteractionStreamSnapshot: "managed-agents:get-interaction-stream-snapshot",
  interactionStreamEvent: "managed-agents:interaction-stream-event",
  getInteraction: "managed-agents:get-interaction",
  cancelInteraction: "managed-agents:cancel-interaction",
  deleteInteraction: "managed-agents:delete-interaction",
  downloadSnapshot: "managed-agents:download-snapshot",
  listEnvironmentOutputFiles: "managed-agents:list-environment-output-files",
  saveEnvironmentOutputFile: "managed-agents:save-environment-output-file",
  openEnvironmentOutputFile: "managed-agents:open-environment-output-file",
  readEnvironmentOutputText: "managed-agents:read-environment-output-text",
  saveText: "managed-agents:save-text",
  loadStoredSessions: "managed-agents:load-stored-sessions",
  saveStoredSessions: "managed-agents:save-stored-sessions",
  saveStoredSessionsSync: "managed-agents:save-stored-sessions-sync",
  appendConversationDiagnostics: "managed-agents:append-conversation-diagnostics",
  openExternal: "managed-agents:open-external"
} as const;
