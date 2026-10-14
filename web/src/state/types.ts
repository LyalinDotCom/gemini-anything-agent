import { MODELS, type HarnessModel } from "../models";
import type { LargeImageTemplate } from "../../../shared/largeImageProfile";
import type { Usage } from "../gemini/streamAdapter";
import type { AgentMode } from "../agentProfiles";
import type { Object3dMethod } from "../../../shared/object3dProfile";

export type SessionMode = "chat" | "deep-research";

export interface RunOptions {
  agentModel: HarnessModel;
  store: boolean;
  autoContinue: boolean;
  reuseEnvironment: boolean;
  background: boolean;
  serviceTier: "standard" | "flex" | "priority";
  thinkingSummaries: "none" | "auto";
  overrideSystemInstruction: boolean;
  systemInstruction: string;
  overrideTools: boolean;
  toolTypes: Array<"code_execution" | "google_search" | "url_context">;
  overrideEnvironment: boolean;
  environmentId: string;
  previousInteractionId: string;
  useCredential: boolean;
  credentialId: string;
  credentialDomain: string;
}

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  agentModel: MODELS.text,
  store: true,
  autoContinue: true,
  reuseEnvironment: true,
  background: true,
  serviceTier: "standard",
  thinkingSummaries: "none",
  overrideSystemInstruction: false,
  systemInstruction: "",
  overrideTools: false,
  toolTypes: ["code_execution", "google_search", "url_context"],
  overrideEnvironment: false,
  environmentId: "",
  previousInteractionId: "",
  useCredential: false,
  credentialId: "",
  credentialDomain: "",
};

export interface OutputFileRecord {
  fingerprint: string;
  remoteOnly?: boolean;
  environmentId?: string;
  path: string;
  label: string;
  kind: "image" | "audio" | "video" | "html" | "text" | "file";
  mediaId: string;
  mimeType: string;
  size: number;
  syncedAt: number;
}

/** Small session index entry — persisted in localStorage (bodies live in IndexedDB). */
export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  mode: SessionMode;
  /** Pinned on the first submitted turn; stopping never releases this choice. */
  modelUsed?: HarnessModel;
  /** Selected before the first turn, then pinned for the life of the conversation. */
  agentMode?: AgentMode;
  /** Photographic object method; Blender packages every method. */
  object3dMethod?: Object3dMethod;
  largeImageTemplate?: LargeImageTemplate;
  /** Gallery-selected photo, consumed by the composer without sending a turn. */
  samplePhoto?: "person-cat" | "rocket";
  /** Shared payload installed when the photographic workspace was started. */
  object3dPayloadFingerprint?: string;
  agentPayloadFingerprint?: string;
  migrationContext?: string | null;
  cancelNotice?: string;
  /** Advanced request controls, scoped to this conversation. */
  runOptions?: RunOptions;
  /** Display name for a user-approved local project directory handle stored in IDB. */
  localProjectName?: string | null;
  /** Chain cursor: the server-side conversation state lives behind this id. */
  lastInteractionId: string | null;
  /** Remote sandbox id — REQUIRED on continuation requests. */
  environmentId: string | null;
  /** Set when a continuation 404s (server chain expired); next turn reseeds. */
  chainBroken?: boolean;
  /** Total messages ever appended — the authoritative "has this chat started?" signal. */
  messageCount: number;
  /** Deep-research bookkeeping: a run that survives reloads. */
  research?: { interactionId: string; startedAt: number; lastEventId?: string } | null;
  /** Fingerprints (path@size) of container /output/ files already synced to this device. */
  envSeen?: string[];
  /** Visible files from /workspace/output that are available locally for preview/download. */
  envFiles?: OutputFileRecord[];
  /** The agent this conversation is pinned to (set on first turn, never changes). */
  agentUsed?: string | null;
  /**
   * A turn the server has acked but this client hasn't seen finish (set at
   * interaction.created, cleared at settle). If present after a reload, the server —
   * not local cache — is the source of truth and we reattach. Absent = finished
   * state, render purely from cache with zero server calls.
   */
  pending?: { interactionId: string; messageId: string; startedAt: number; workflowFingerprint?: string } | null;
}

export type MessageStatus = "complete" | "streaming" | "stopped" | "error";

export interface ToolActivity {
  tool: "code_execution" | "google_search" | "url_context" | "generate_image" | "function" | "setup" | "other";
  label: string;
  status: "running" | "done" | "error";
  callId?: string;
  /** >1 when consecutive same-tool actions were grouped into this chip. */
  count?: number;
  /** Raw args/result for the expandable detail view. */
  detail?: unknown;
}

export interface CodeRun {
  callId?: string;
  code: string;
  result?: string;
  isError?: boolean;
  done: boolean;
}

export type ContentPart =
  | { kind: "text"; id: string; text: string }
  | { kind: "thought"; id: string; text: string }
  | { kind: "code"; id: string; runs: CodeRun[]; done: boolean }
  | { kind: "tool"; id: string; activity: ToolActivity }
  | {
      kind: "image";
      id: string;
      mediaId: string;
      mimeType: string;
      origin: "generated" | "uploaded" | "agent";
      prompt?: string;
    }
  | { kind: "audio"; id: string; mediaId: string; mimeType: string; label: string }
  | { kind: "video"; id: string; mediaId: string; mimeType: string; label: string }
  | { kind: "file"; id: string; mediaId: string; mimeType: string; label: string };

export interface Message {
  id: string;
  role: "user" | "assistant";
  createdAt: number;
  completedAt?: number;
  status: MessageStatus;
  parts: ContentPart[];
  /** Assistant messages: the interaction that produced them. */
  interactionId?: string;
  usage?: Usage;
  errorMessage?: string;
}
