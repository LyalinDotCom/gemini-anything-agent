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

export type SnapshotDownloadResult =
  | { saved: true; path: string; bytes: number }
  | { saved: false; canceled: true };

export type InteractionStreamSnapshot = {
  events: InteractionStreamEvent[];
  latestInteraction?: Interaction;
  done: boolean;
  lastEventId?: string;
};

export type AgentProjectFileSnapshot = {
  path: string;
  content: string;
};

export type AgentProjectSnapshot = {
  agentId: string;
  rootPath: string;
  files: AgentProjectFileSnapshot[];
};

export type IpcError = {
  name: string;
  message: string;
  status?: number;
  errors?: string[];
  details?: unknown;
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
  loadAgentProject: (agentId: string) => Promise<IpcResult<AgentProjectSnapshot>>;
  saveAgentProject: (
    agentId: string,
    files: AgentProjectFileSnapshot[]
  ) => Promise<IpcResult<AgentProjectSnapshot>>;
  openAgentProject: (agentId: string) => Promise<IpcResult<boolean>>;
  openExternal: (url: string) => Promise<IpcResult<boolean>>;
};

export const ipcChannels = {
  runtimeConfig: "managed-agents:runtime-config",
  setApiKey: "managed-agents:set-api-key",
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
  loadAgentProject: "managed-agents:load-agent-project",
  saveAgentProject: "managed-agents:save-agent-project",
  openAgentProject: "managed-agents:open-agent-project",
  openExternal: "managed-agents:open-external"
} as const;
