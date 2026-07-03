import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  IpcResult,
  EnvironmentOutputFile,
  ChatSessionStoreSnapshot,
  EnsureAnythingAgentResult,
  InteractionStreamSnapshot,
  ManagedAgentsBridge,
  PersistedSession,
  ReadEnvironmentOutputTextResult,
  RuntimeConfig,
  SaveResolvedMediaResult,
  SaveTextResult,
  SetApiKeyResult,
  SetSpecializedToolsResult,
  SnapshotDownloadResult
} from "../shared/electron-api";
import { ipcChannels } from "../shared/electron-api";
import type {
  AgentDefinition,
  AgentListResponse,
  Interaction,
  InteractionCreateRequest,
  InteractionStreamEvent,
  ManagedAgent
} from "../sdk";

const invoke = <T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> =>
  ipcRenderer.invoke(channel, ...args);

const bridge: ManagedAgentsBridge = {
  getRuntimeConfig: () => invoke<RuntimeConfig>(ipcChannels.runtimeConfig),
  setApiKey: (key: string) => invoke<SetApiKeyResult>(ipcChannels.setApiKey, key),
  setSpecializedToolsEnabled: (enabled: boolean) =>
    invoke<SetSpecializedToolsResult>(ipcChannels.setSpecializedToolsEnabled, enabled),
  ensureAnythingAgent: (agentId?: string) =>
    invoke<EnsureAnythingAgentResult>(ipcChannels.ensureAnythingAgent, agentId),
  createAgent: (agent: AgentDefinition) => invoke<ManagedAgent>(ipcChannels.createAgent, agent),
  listAgents: () => invoke<AgentListResponse>(ipcChannels.listAgents),
  getAgent: (id: string) => invoke<ManagedAgent>(ipcChannels.getAgent, id),
  deleteAgent: (id: string) => invoke<boolean>(ipcChannels.deleteAgent, id),
  createInteraction: (request: InteractionCreateRequest) =>
    invoke<Interaction>(ipcChannels.createInteraction, request),
  createInteractionStream: (streamId: string, request: InteractionCreateRequest) =>
    invoke<Interaction>(ipcChannels.createInteractionStream, streamId, request),
  resumeInteractionStream: (streamId: string, interactionId: string, lastEventId?: string) =>
    invoke<Interaction>(ipcChannels.resumeInteractionStream, streamId, interactionId, lastEventId),
  cancelInteractionStream: (streamId: string) =>
    invoke<boolean>(ipcChannels.cancelInteractionStream, streamId),
  getInteractionStreamSnapshot: (streamId: string) =>
    invoke<InteractionStreamSnapshot>(ipcChannels.getInteractionStreamSnapshot, streamId),
  onInteractionStreamEvent: (streamId: string, callback: (event: InteractionStreamEvent) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { streamId: string; event: InteractionStreamEvent }
    ) => {
      if (payload.streamId === streamId) {
        callback(payload.event);
      }
    };
    ipcRenderer.on(ipcChannels.interactionStreamEvent, listener);
    return () => ipcRenderer.removeListener(ipcChannels.interactionStreamEvent, listener);
  },
  getInteraction: (id: string) => invoke<Interaction>(ipcChannels.getInteraction, id),
  cancelInteraction: (id: string) => invoke<Interaction>(ipcChannels.cancelInteraction, id),
  deleteInteraction: (id: string) => invoke<boolean>(ipcChannels.deleteInteraction, id),
  downloadEnvironmentSnapshot: (environmentId: string) =>
    invoke<SnapshotDownloadResult>(ipcChannels.downloadSnapshot, environmentId),
  listEnvironmentOutputFiles: (environmentId: string, force?: boolean) =>
    invoke<EnvironmentOutputFile[]>(ipcChannels.listEnvironmentOutputFiles, environmentId, force),
  saveEnvironmentOutputFile: (path: string) =>
    invoke<SaveResolvedMediaResult>(ipcChannels.saveEnvironmentOutputFile, path),
  openEnvironmentOutputFile: (path: string) =>
    invoke<boolean>(ipcChannels.openEnvironmentOutputFile, path),
  readEnvironmentOutputText: (path: string) =>
    invoke<ReadEnvironmentOutputTextResult>(ipcChannels.readEnvironmentOutputText, path),
  saveText: (content: string, defaultFileName?: string) =>
    invoke<SaveTextResult>(ipcChannels.saveText, content, defaultFileName),
  loadStoredSessions: () =>
    invoke<ChatSessionStoreSnapshot>(ipcChannels.loadStoredSessions),
  saveStoredSessions: (sessions: PersistedSession[]) =>
    invoke<ChatSessionStoreSnapshot>(ipcChannels.saveStoredSessions, sessions),
  saveStoredSessionsSync: (sessions: PersistedSession[]): boolean => {
    try {
      return ipcRenderer.sendSync(ipcChannels.saveStoredSessionsSync, sessions) === true;
    } catch {
      return false;
    }
  },
  appendConversationDiagnostics: (
    conversationId: string,
    entry: { at: string; event: string; detail?: string }
  ): void => {
    ipcRenderer.send(ipcChannels.appendConversationDiagnostics, conversationId, entry);
  },
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  openExternal: (url: string) => invoke<boolean>(ipcChannels.openExternal, url)
};

contextBridge.exposeInMainWorld("managedAgents", bridge);
