import {
  ANTIGRAVITY_BASE_AGENT,
  normalizeAgentDefinition,
  type AgentDefinition,
  type EnvironmentConfig,
  type EnvironmentSource,
  type InteractionCreateRequest,
  type InteractionInput,
  type NetworkRule,
  type ToolConfig,
  type ToolType
} from "@sdk";
import type { BadgeState } from "./badges";
import {
  resolveActiveEnvFile,
  type BuilderDraft,
  type ComposeState,
  type NetworkRuleDraft,
  type ProjectFileDraft,
  type SourceDraft
} from "./builderState";
import { projectFileIssue } from "./projectFiles";

export const TOOL_TYPES: ToolType[] = ["code_execution", "google_search", "url_context"];

export const selectedToolList = (draft: BuilderDraft): ToolConfig[] =>
  TOOL_TYPES.filter((type) => draft.selectedTools[type]).map((type) => ({ type }));

const draftToSource = (source: SourceDraft): EnvironmentSource | undefined => {
  const target = source.target.trim();
  if (!target) {
    return undefined;
  }
  if (source.type === "inline") {
    return source.content.trim() ? { type: "inline", target, content: source.content } : undefined;
  }
  const remoteSource = source.source.trim();
  if (!remoteSource) {
    return undefined;
  }
  return { type: source.type, source: remoteSource, target };
};

export const projectFileToSource = (file: ProjectFileDraft): EnvironmentSource | undefined => {
  const target = file.target.trim();
  if (!target || !file.content.trim() || projectFileIssue(file)) {
    return undefined;
  }
  return { type: "inline", target, content: file.content };
};

/**
 * The inline sources contributed by project files. Only the ACTIVE .env is baked
 * into the sandbox (at `.env`); the other named .env files are a local library and
 * are intentionally excluded so they do not collide on the `.env` target.
 */
export const projectFileSources = (draft: BuilderDraft): EnvironmentSource[] => {
  const activeEnvId = resolveActiveEnvFile(draft)?.id;
  return draft.projectFiles
    .filter((file) => file.kind !== "env" || file.id === activeEnvId)
    .map(projectFileToSource)
    .filter(Boolean) as EnvironmentSource[];
};

const draftToNetworkRule = (rule: NetworkRuleDraft): NetworkRule | undefined => {
  const domain = rule.domain.trim();
  if (!domain) {
    return undefined;
  }
  const transform = Object.fromEntries(
    rule.headers
      .map((header) => [header.key.trim(), header.value] as const)
      .filter(([key, value]) => key.length > 0 && value.length > 0)
  );
  return {
    domain,
    transform: Object.keys(transform).length ? transform : undefined
  };
};

/**
 * Returns the base_environment value to send, or `undefined` to OMIT it entirely.
 * Omitting it is the documented default (a fresh remote sandbox), so "remote"
 * mode contributes no key -- this keeps DEFAULT cards honest in the payload.
 */
export const buildEnvironment = (
  draft: BuilderDraft
): AgentDefinition["base_environment"] | undefined => {
  const projectSources = projectFileSources(draft);
  if (draft.environmentMode === "remote" && projectSources.length === 0) {
    return undefined;
  }
  if (draft.environmentMode === "environment_id") {
    return draft.environmentId.trim() || undefined;
  }

  const environment: EnvironmentConfig = { type: "remote" };
  const advancedSources = draft.sources.map(draftToSource).filter(Boolean) as EnvironmentSource[];
  const sources = [...projectSources, ...advancedSources];
  if (sources.length) {
    environment.sources = sources;
  }
  if (draft.networkMode === "disabled") {
    environment.network = "disabled";
  } else if (draft.networkMode === "allowlist") {
    const allowlist = draft.networkRules.map(draftToNetworkRule).filter(Boolean) as NetworkRule[];
    if (allowlist.length) {
      environment.network = { allowlist };
    }
  }
  return environment;
};

export const buildAgent = (draft: BuilderDraft): AgentDefinition => {
  const agent: AgentDefinition = {
    id: draft.id,
    base_agent: ANTIGRAVITY_BASE_AGENT
  };

  if (draft.description.trim()) {
    agent.description = draft.description;
  }
  if (draft.systemInstruction.trim()) {
    agent.system_instruction = draft.systemInstruction;
  }
  if (draft.toolMode === "custom") {
    agent.tools = selectedToolList(draft);
  }
  const environment = buildEnvironment(draft);
  if (environment !== undefined) {
    agent.base_environment = environment;
  }

  return normalizeAgentDefinition(agent);
};

const composeInput = (compose: ComposeState): InteractionInput => {
  const images = compose.parts.filter((part) => part.kind === "image");
  if (images.length === 0) {
    return compose.input;
  }
  return [
    ...(compose.input.trim() ? [{ type: "text" as const, text: compose.input }] : []),
    ...images.map((part) => ({ type: "image" as const, data: part.data, mime_type: part.mimeType }))
  ];
};

export const buildInteraction = (
  draft: BuilderDraft,
  compose: ComposeState
): InteractionCreateRequest => {
  const request: InteractionCreateRequest = {
    agent: draft.id.trim(),
    input: composeInput(compose),
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
    request.tools = selectedToolList(draft);
  }
  if (compose.overrideEnvironment && compose.environmentId.trim()) {
    request.environment = compose.environmentId.trim();
  }

  return request;
};

/* ------------------------------------------------------------------ *
 * Tagged payload AST: drives the Payload drawer (MINIMAL vs FULL) and
 * teaches "omitted == default" by materializing the keys you left out.
 * ------------------------------------------------------------------ */

export type PayloadNode = {
  keyPath: string;
  rendered: string;
  state: BadgeState;
  /** present === in the real wire body (the MINIMAL view). */
  present: boolean;
  note?: string;
};

const compact = (value: unknown): string => {
  const json = JSON.stringify(value);
  if (!json) {
    return String(value);
  }
  return json.length > 80 ? `${json.slice(0, 77)}…` : json;
};

const environmentSummary = (draft: BuilderDraft): string => {
  if (draft.environmentMode === "environment_id") {
    return `"${draft.environmentId.trim() || "(missing id)"}"`;
  }
  const parts: string[] = ["config"];
  const sources = [
    ...projectFileSources(draft),
    ...(draft.sources.map(draftToSource).filter(Boolean) as EnvironmentSource[])
  ];
  if (sources.length) {
    parts.push(`${sources.length} source${sources.length === 1 ? "" : "s"}`);
  }
  if (draft.networkMode === "disabled") {
    parts.push("network disabled");
  } else if (
    draft.networkMode === "allowlist" &&
    draft.networkRules.some((rule) => rule.domain.trim().length > 0)
  ) {
    parts.push("network allowlist");
  }
  return parts.join(", ");
};

export const buildAgentNodes = (draft: BuilderDraft): PayloadNode[] => {
  const nodes: PayloadNode[] = [
    { keyPath: "id", rendered: compact(draft.id), state: "required", present: true },
    {
      keyPath: "base_agent",
      rendered: compact(ANTIGRAVITY_BASE_AGENT),
      state: "fixed",
      present: true
    }
  ];

  nodes.push(
    draft.description.trim()
      ? { keyPath: "description", rendered: compact(draft.description), state: "custom", present: true }
      : {
          keyPath: "description",
          rendered: "(none)",
          state: "default",
          present: false,
          note: "Omitted -> the agent has no description."
        }
  );

  nodes.push(
    draft.systemInstruction.trim()
      ? {
          keyPath: "system_instruction",
          rendered: compact(draft.systemInstruction),
          state: "custom",
          present: true
        }
      : {
          keyPath: "system_instruction",
          rendered: "(none)",
          state: "default",
          present: false,
          note: "Omitted -> the base agent's built-in persona."
        }
  );

  nodes.push(
    draft.toolMode === "custom" && selectedToolList(draft).length > 0
      ? {
          keyPath: "tools",
          rendered: compact(selectedToolList(draft).map((tool) => (tool as { type: string }).type)),
          state: "custom",
          present: true
        }
      : {
          keyPath: "tools",
          rendered: "all base tools",
          state: "default",
          present: false,
          note: "Omitted -> inherits the base agent's default tools."
        }
  );

  nodes.push(
    draft.environmentMode !== "remote" || projectFileSources(draft).length > 0
      ? {
          keyPath: "base_environment",
          rendered: environmentSummary(draft),
          state: "custom",
          present: true
        }
      : {
          keyPath: "base_environment",
          rendered: '"remote"',
          state: "default",
          present: false,
          note: "Omitted -> a fresh, clean remote Linux sandbox per run."
        }
  );

  return nodes;
};

const inputSummary = (compose: ComposeState): string => {
  const images = compose.parts.filter((part) => part.kind === "image").length;
  if (images === 0) {
    return compact(compose.input);
  }
  return `${compose.input.trim() ? compact(compose.input) : "(no text)"}, ${images} image${images === 1 ? "" : "s"}`;
};

export const buildInteractionNodes = (
  draft: BuilderDraft,
  compose: ComposeState,
  effectivePreviousInteractionId = compose.previousInteractionId.trim(),
  effectiveEnvironment = compose.overrideEnvironment && compose.environmentId.trim()
    ? compose.environmentId.trim()
    : "remote"
): PayloadNode[] => {
  const nodes: PayloadNode[] = [
    { keyPath: "agent", rendered: compact(draft.id.trim()), state: "required", present: true },
    { keyPath: "input", rendered: inputSummary(compose), state: "required", present: true },
    { keyPath: "store", rendered: String(compose.store), state: "custom", present: true },
    compose.background && compose.store
      ? { keyPath: "background", rendered: "true", state: "custom", present: true }
      : {
          keyPath: "background",
          rendered: "false",
          state: "default",
          present: false,
          note: compose.store
            ? "Omitted -> foreground request."
            : "Omitted -> background mode requires store=true."
        },
    compose.serviceTier !== "standard"
      ? { keyPath: "service_tier", rendered: compact(compose.serviceTier), state: "custom", present: true }
      : {
          keyPath: "service_tier",
          rendered: "standard",
          state: "default",
          present: false,
          note: "Omitted -> standard inference tier."
        },
    compose.thinkingSummaries !== "none"
      ? {
          keyPath: "agent_config.thinking_summaries",
          rendered: compact(compose.thinkingSummaries),
          state: "custom",
          present: true
        }
      : {
          keyPath: "agent_config.thinking_summaries",
          rendered: "none",
          state: "default",
          present: false,
          note: "Omitted -> do not request thought summaries."
        }
  ];

  nodes.push(
    effectivePreviousInteractionId
      ? {
          keyPath: "previous_interaction_id",
          rendered: compact(effectivePreviousInteractionId),
          state: "custom",
          present: true
        }
      : {
          keyPath: "previous_interaction_id",
          rendered: "(none)",
          state: "default",
          present: false,
          note: "Omitted -> starts a brand-new conversation."
        }
  );

  nodes.push(
    compose.overrideSystemInstruction && compose.systemInstruction.trim()
      ? {
          keyPath: "system_instruction",
          rendered: compact(compose.systemInstruction.trim()),
          state: "custom",
          present: true
        }
      : {
          keyPath: "system_instruction",
          rendered: "from agent",
          state: "default",
          present: false,
          note: "Omitted -> uses the saved agent's instruction."
        }
  );

  nodes.push(
    compose.overrideTools
      ? {
          keyPath: "tools",
          rendered: compact(selectedToolList(draft).map((tool) => (tool as { type: string }).type)),
          state: "custom",
          present: true
        }
      : {
          keyPath: "tools",
          rendered: "from agent",
          state: "default",
          present: false,
          note: "Omitted -> uses the saved agent's tools."
        }
  );

  nodes.push(
    effectiveEnvironment !== "remote"
      ? {
          keyPath: "environment",
          rendered: compact(effectiveEnvironment),
          state: "custom",
          present: true,
          note: "Uses an existing sandbox environment for this run."
        }
      : {
          keyPath: "environment",
          rendered: compact("remote"),
          state: "required",
          present: true,
          note: "Required -> provisions a fresh remote sandbox for this run."
        }
  );

  return nodes;
};

/** Replace huge base64 image payloads with a short label so the drawer/clipboard stay readable. */
export const redactForDisplay = (request: InteractionCreateRequest): InteractionCreateRequest => {
  if (Array.isArray(request.input)) {
    return {
      ...request,
      input: request.input.map((part) =>
        part.type === "image"
          ? {
              ...part,
              data: `<base64 ${Math.round((part.data.length * 3) / 4 / 1024)} KB ${part.mime_type}>`
            }
          : part
      )
    };
  }
  return request;
};
