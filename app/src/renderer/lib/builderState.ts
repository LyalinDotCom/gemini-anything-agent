import type {
  EnvironmentSource,
  Interaction,
  InteractionCreateRequest,
  InteractionStreamEvent,
  ManagedAgent,
  ServiceTier,
  ThinkingSummaries,
  ToolType
} from "@sdk";
import type { IpcError, ResolvedEnvironmentMedia } from "../../shared/electron-api";

export type EnvironmentMode = "remote" | "environment_id" | "config";
export type NetworkMode = "unrestricted" | "allowlist" | "disabled";
export type ToolMode = "default" | "custom";
export type SourceDraftType = EnvironmentSource["type"];

export type HeaderDraft = {
  id: string;
  key: string;
  value: string;
};

export type NetworkRuleDraft = {
  id: string;
  domain: string;
  headers: HeaderDraft[];
};

export type SourceDraft = {
  id: string;
  type: SourceDraftType;
  source: string;
  target: string;
  content: string;
};

export type ProjectFileKind = "instructions" | "skill" | "env" | "asset";

export type ProjectFileDraft = {
  id: string;
  kind: ProjectFileKind;
  name: string;
  target: string;
  content: string;
};

/**
 * The single source of truth the Build Sheet edits. Everything else (the live
 * payload, the badge states, validation, and the wire request) is *derived*
 * from this draft so they can never disagree.
 */
export type BuilderDraft = {
  id: string;
  description: string;
  systemInstruction: string;
  projectFiles: ProjectFileDraft[];
  /** id of the .env baked into the sandbox; empty falls back to the first .env. */
  activeEnvFileId: string;
  environmentMode: EnvironmentMode;
  environmentId: string;
  sources: SourceDraft[];
  networkMode: NetworkMode;
  networkRules: NetworkRuleDraft[];
  toolMode: ToolMode;
  selectedTools: Record<ToolType, boolean>;
};

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
  bytes: number;
};

export type InputPartDraft = TextPartDraft | ImagePartDraft;

/**
 * State for the Run Console's Compose bar. The agent id is always taken from the
 * Build Sheet (the agent you are building), so it is not duplicated here.
 */
export type ComposeState = {
  inputMode: "string" | "parts";
  input: string;
  parts: InputPartDraft[];
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
  /** Media already resolved and auto-saved locally for this run. */
  resolvedMedia?: ResolvedEnvironmentMedia[];
  /** Set when this run was started via "Continue" from another session. */
  parentLocalId?: string;
};

export const uid = (): string => Math.random().toString(36).slice(2, 10);

export const slug = (value: string, fallback = "file"): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
};

export const newAgentInstructions = (): ProjectFileDraft => ({
  id: uid(),
  kind: "instructions",
  name: "AGENTS.md",
  target: ".agents/AGENTS.md",
  content: [
    "# Agent Instructions",
    "",
    "You are a concise managed agent. Inspect the workspace, explain tradeoffs, run commands when useful, and save artifacts."
  ].join("\n")
});

export const newEnvFile = (name = ".env"): ProjectFileDraft => ({
  id: uid(),
  kind: "env",
  name,
  target: ".env",
  content: [
    "GITHUB_REPOSITORY=",
    "GITHUB_TOKEN=",
    "GIT_AUTHOR_NAME=Managed Agent",
    "GIT_AUTHOR_EMAIL=managed-agent@example.com"
  ].join("\n")
});

/** The .env files in a draft, in project order. */
export const envFileDrafts = (files: ProjectFileDraft[]): ProjectFileDraft[] =>
  files.filter((file) => file.kind === "env");

/** The .env baked into the sandbox: the explicitly active one, else the first .env. */
export const resolveActiveEnvFile = (draft: BuilderDraft): ProjectFileDraft | undefined => {
  const envs = envFileDrafts(draft.projectFiles);
  return envs.find((file) => file.id === draft.activeEnvFileId) ?? envs[0];
};

/** A .env filename not already used by another .env in the draft. */
export const uniqueEnvName = (files: ProjectFileDraft[]): string => {
  const taken = new Set(envFileDrafts(files).map((file) => file.name.trim()));
  if (!taken.has(".env")) {
    return ".env";
  }
  for (let index = 2; ; index += 1) {
    const candidate = `.env.${index}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
};

export const newAssetFile = (name = "notes.md"): ProjectFileDraft => {
  const fileName = slug(name, "asset.md");
  return {
    id: uid(),
    kind: "asset",
    name: fileName,
    target: `assets/${fileName}`,
    content: ""
  };
};

export const newInlineSource = (): SourceDraft => ({
  id: uid(),
  type: "inline",
  source: "",
  target: ".agents/AGENTS.md",
  content: "Prefer concise plans, reproducible commands, and saved artifacts."
});

export const newSourceOfType = (type: SourceDraftType): SourceDraft => ({
  id: uid(),
  type,
  source:
    type === "repository"
      ? "https://github.com/example/repo.git"
      : type === "gcs"
        ? "gs://bucket/path"
        : "",
  target:
    type === "repository" ? "repo" : type === "gcs" ? "data" : ".agents/AGENTS.md",
  content:
    type === "inline"
      ? "Prefer concise plans, reproducible commands, and saved artifacts."
      : ""
});

export const newNetworkRule = (): NetworkRuleDraft => ({
  id: uid(),
  domain: "api.example.com",
  headers: []
});

export const newTextPart = (): TextPartDraft => ({
  id: uid(),
  kind: "text",
  text: ""
});

/** The smallest possible valid agent: an id and the fixed base agent. Everything else rests on defaults. */
export const minimalBuilder = (): BuilderDraft => ({
  id: "my-first-agent",
  description: "",
  systemInstruction: "",
  projectFiles: [newAgentInstructions()],
  activeEnvFileId: "",
  environmentMode: "remote",
  environmentId: "",
  sources: [],
  networkMode: "unrestricted",
  networkRules: [],
  toolMode: "default",
  selectedTools: {
    code_execution: true,
    google_search: true,
    url_context: true
  }
});

export const initialBuilder: BuilderDraft = minimalBuilder();

export const initialCompose: ComposeState = {
  inputMode: "string",
  input: "",
  parts: [],
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
