import type {
  Interaction,
  InteractionCreateRequest,
  InteractionStreamEvent,
  ManagedAgent,
  ServiceTier,
  ThinkingSummaries
} from "@sdk";
import type { IpcError } from "../../shared/electron-api";

export type TextPartDraft = {
  id: string;
  kind: "text";
  text: string;
};

export type ImagePartDraft = {
  id: string;
  kind: "image";
  data: string;
  mimeType: string;
  name: string;
  path?: string;
  bytes: number;
};

export type InputPartDraft = TextPartDraft | ImagePartDraft;

export type ImageAttachmentMeta = {
  id: string;
  name: string;
  path?: string;
  bytes: number;
  mimeType: string;
};

/**
 * State for the Run Console's Compose bar. The agent id is always taken from the
 * Build Sheet (the agent you are building), so it is not duplicated here.
 */
/** Which managed agent handles the next run. */
export type AgentMode = "antigravity" | "anything" | "browser" | "deep-research" | "deep-research-max";

export type ComposeState = {
  inputMode: "string" | "parts";
  input: string;
  parts: InputPartDraft[];
  agentMode: AgentMode;
  store: boolean;
  autoContinue: boolean;
  reuseEnvironment: boolean;
  background: boolean;
  serviceTier: ServiceTier;
  thinkingSummaries: ThinkingSummaries;
  previousInteractionId: string;
  overrideSystemInstruction: boolean;
  systemInstruction: string;
  overrideTools: boolean;
  overrideEnvironment: boolean;
  environmentId: string;
};

/** One run in the Run Console: the request sent plus the latest interaction state. */
export type Session = {
  localId: string;
  agentId: string;
  /** Saved agent definition as it existed when the run was started. */
  agentSnapshot?: ManagedAgent;
  request: InteractionCreateRequest;
  /** The createInteraction response; the poller refreshes from here. */
  seed?: Interaction;
  /** Streamed interaction events captured while a run is active. */
  events?: InteractionStreamEvent[];
  streaming?: boolean;
  streamId?: string;
  startedAt: number;
  /** Set when the run reaches a terminal state so the UI can show true turn duration. */
  completedAt?: number;
  error?: IpcError;
  /** Local UI metadata for image inputs sent with this run. Image bytes live in request.input. */
  imageAttachments?: ImageAttachmentMeta[];
  /** Set when this run was started via "Continue" from another session. */
  parentLocalId?: string;
  /**
   * Original agent id when the session was renamed by the legacy-agent
   * migration. Interactions in this session were created under that agent, so
   * continuing from them must start a fresh server-side chain.
   */
  migratedFromAgentId?: string;
};

export const uid = (): string => Math.random().toString(36).slice(2, 10);

export const initialCompose: ComposeState = {
  inputMode: "string",
  input: "",
  parts: [],
  agentMode: "antigravity",
  store: true,
  autoContinue: true,
  reuseEnvironment: true,
  background: true,
  serviceTier: "standard",
  thinkingSummaries: "none",
  previousInteractionId: "",
  overrideSystemInstruction: false,
  systemInstruction: "",
  overrideTools: false,
  overrideEnvironment: false,
  environmentId: ""
};
