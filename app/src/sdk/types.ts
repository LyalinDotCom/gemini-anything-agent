export const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_API_REVISION = "2026-05-20";
export const ANTIGRAVITY_BASE_AGENT = "antigravity-preview-05-2026";

// Deep Research managed agents are invoked directly by base-agent id in the
// `agent` field of POST /interactions; they are not created as custom agents.
// See https://ai.google.dev/gemini-api/docs/deep-research
export const DEEP_RESEARCH_AGENT = "deep-research-preview-04-2026";
export const DEEP_RESEARCH_MAX_AGENT = "deep-research-max-preview-04-2026";

export const isDeepResearchAgentId = (agentId: string): boolean => {
  const id = agentId.trim();
  return id === DEEP_RESEARCH_AGENT || id === DEEP_RESEARCH_MAX_AGENT;
};

export type BaseAgentId =
  | typeof ANTIGRAVITY_BASE_AGENT
  | typeof DEEP_RESEARCH_AGENT
  | typeof DEEP_RESEARCH_MAX_AGENT;

export type ToolType = "code_execution" | "google_search" | "url_context";

export type ToolConfig =
  | ToolType
  | {
      type: ToolType;
      [key: string]: unknown;
    };

export type InlineSource = {
  type: "inline";
  target: string;
  content: string;
};

export type RepositorySource = {
  type: "repository";
  source: string;
  target: string;
};

export type GcsSource = {
  type: "gcs";
  source: string;
  target: string;
};

export type EnvironmentSource = InlineSource | RepositorySource | GcsSource;

export type NetworkRule = {
  domain: string;
  transform?: Record<string, string>;
};

export type NetworkConfig = {
  allowlist: NetworkRule[];
};

export type EnvironmentConfig = {
  type: "remote";
  sources?: EnvironmentSource[];
  network?: NetworkConfig | "disabled";
};

export type EnvironmentReference = "remote" | string | EnvironmentConfig;

export type ThinkingSummaries = "auto" | "none";
export type ServiceTier = "standard" | "flex" | "priority";

export type AgentConfig =
  | {
      type: "dynamic";
      thinking_summaries?: ThinkingSummaries;
      [key: string]: unknown;
    }
  | {
      type: "deep-research";
      thinking_summaries?: ThinkingSummaries;
      visualization?: "off" | "auto";
      collaborative_planning?: boolean;
      enable_bigquery_tool?: boolean;
      [key: string]: unknown;
    };

export type GenerationConfig = {
  thinking_level?: "minimal" | "low" | "medium" | "high";
  thinking_summaries?: ThinkingSummaries;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  [key: string]: unknown;
};

export type AgentDefinition = {
  id: string;
  description?: string;
  base_agent: BaseAgentId;
  system_instruction?: string;
  tools?: ToolConfig[];
  base_environment?: EnvironmentReference;
};

export type ManagedAgent = AgentDefinition & {
  name?: string;
  create_time?: string;
  update_time?: string;
  [key: string]: unknown;
};

export type AgentListResponse = {
  agents?: ManagedAgent[];
  next_page_token?: string;
  [key: string]: unknown;
};

export type TextInputPart = {
  type: "text";
  text: string;
};

export type ImageInputPart = {
  type: "image";
  data: string;
  mime_type: string;
};

export type InteractionInput = string | Array<TextInputPart | ImageInputPart>;

export type InteractionCreateRequest = {
  agent: string;
  input: InteractionInput;
  environment: EnvironmentReference;
  previous_interaction_id?: string;
  system_instruction?: string;
  tools?: ToolConfig[];
  store?: boolean;
  background?: boolean;
  agent_config?: AgentConfig;
  generation_config?: GenerationConfig;
  service_tier?: ServiceTier;
};

export type InteractionUsage = {
  total_tokens?: number;
  total_input_tokens?: number;
  input_tokens_by_modality?: Array<{ modality?: string; tokens?: number; [key: string]: unknown }>;
  total_cached_tokens?: number;
  total_output_tokens?: number;
  output_tokens_by_modality?: Array<{ modality?: string; tokens?: number; [key: string]: unknown }>;
  total_tool_use_tokens?: number;
  total_thought_tokens?: number;
  [key: string]: unknown;
};

export type Interaction = {
  id: string;
  status?: string;
  output_text?: string;
  environment_id?: string;
  steps?: unknown[];
  usage?: InteractionUsage;
  created?: string;
  updated?: string;
  model?: string;
  service_tier?: string;
  object?: string;
  [key: string]: unknown;
};

export type InteractionStreamEvent = {
  event_type: string;
  event_id?: string;
  /**
   * Local monotonic sequence stamped by the app's main process when the event
   * is buffered — NOT part of the wire protocol. Used for exact dedup when the
   * same event arrives via both the push channel and snapshot polls.
   */
  seq?: number;
  interaction?: Interaction;
  interaction_id?: string;
  status?: string;
  index?: number;
  step?: unknown;
  delta?: unknown;
  error?: {
    message?: string;
    code?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type ApiValidationResult<T> =
  | {
      ok: true;
      value: T;
      errors: [];
    }
  | {
      ok: false;
      errors: string[];
    };

export type GeminiClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  apiRevision?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};
