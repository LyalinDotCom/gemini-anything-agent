import { z } from "zod";
import {
  ANTIGRAVITY_BASE_AGENT,
  type AgentDefinition,
  type AgentConfig,
  type ApiValidationResult,
  type EnvironmentConfig,
  type EnvironmentSource,
  type GenerationConfig,
  type InteractionCreateRequest,
  type NetworkRule,
  type ServiceTier,
  type ThinkingSummaries,
  type ToolConfig
} from "./types";

const trimOptional = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const toolTypeSchema = z.enum(["code_execution", "google_search", "url_context"]);

export const toolConfigSchema: z.ZodType<ToolConfig> = z.union([
  toolTypeSchema,
  z.object({ type: toolTypeSchema }).passthrough()
]);

export const thinkingSummariesSchema: z.ZodType<ThinkingSummaries> = z.enum(["auto", "none"]);
export const serviceTierSchema: z.ZodType<ServiceTier> = z.enum(["standard", "flex", "priority"]);

export const agentConfigSchema: z.ZodType<AgentConfig> = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("dynamic"),
    thinking_summaries: thinkingSummariesSchema.optional()
  }).passthrough(),
  z.object({
    type: z.literal("deep-research"),
    thinking_summaries: thinkingSummariesSchema.optional(),
    visualization: z.enum(["off", "auto"]).optional(),
    collaborative_planning: z.boolean().optional(),
    enable_bigquery_tool: z.boolean().optional()
  }).passthrough()
]);

export const generationConfigSchema: z.ZodType<GenerationConfig> = z.object({
  thinking_level: z.enum(["minimal", "low", "medium", "high"]).optional(),
  thinking_summaries: thinkingSummariesSchema.optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_output_tokens: z.number().int().positive().optional()
}).passthrough();

const targetPathSchema = z
  .string()
  .trim()
  .min(1, "target is required")
  .refine((target) => target !== "/", "target cannot be root (/)");

export const inlineSourceSchema = z.object({
  type: z.literal("inline"),
  target: targetPathSchema,
  content: z.string().min(1, "inline content is required")
});

export const repositorySourceSchema = z.object({
  type: z.literal("repository"),
  source: z.string().trim().url("repository source must be a URL"),
  target: targetPathSchema
});

export const gcsSourceSchema = z.object({
  type: z.literal("gcs"),
  source: z.string().trim().startsWith("gs://", "GCS source must start with gs://"),
  target: targetPathSchema
});

export const environmentSourceSchema: z.ZodType<EnvironmentSource> = z.discriminatedUnion(
  "type",
  [inlineSourceSchema, repositorySourceSchema, gcsSourceSchema]
);

export const networkRuleSchema: z.ZodType<NetworkRule> = z.object({
  domain: z.string().trim().min(1, "network domain is required"),
  transform: z.record(z.string().min(1), z.string()).optional()
});

export const networkConfigSchema = z.object({
  allowlist: z.array(networkRuleSchema).min(1, "allowlist needs at least one rule")
});

export const environmentConfigSchema: z.ZodType<EnvironmentConfig> = z.object({
  type: z.literal("remote"),
  sources: z.array(environmentSourceSchema).optional(),
  network: z.union([networkConfigSchema, z.literal("disabled")]).optional()
});

export const agentDefinitionSchema: z.ZodType<AgentDefinition> = z.object({
  id: z
    .string()
    .trim()
    .min(1, "agent id is required")
    .max(128, "agent id should stay under 128 characters"),
  description: z.preprocess(trimOptional, z.string().max(1024).optional()),
  base_agent: z.literal(ANTIGRAVITY_BASE_AGENT),
  system_instruction: z.preprocess(trimOptional, z.string().optional()),
  tools: z.array(toolConfigSchema).optional(),
  base_environment: z.union([environmentConfigSchema, z.string().trim().min(1)]).optional()
});

export const interactionCreateSchema: z.ZodType<InteractionCreateRequest> = z
  .object({
    agent: z.string().trim().min(1, "agent is required"),
    input: z.union([
      z.string().min(1, "input is required"),
      z
        .array(
          z.union([
            z.object({
              type: z.literal("text"),
              text: z.string().min(1, "text input is required")
            }),
            z.object({
              type: z.literal("image"),
              data: z.string().min(1, "image data is required"),
              mime_type: z.string().min(1, "image mime_type is required")
            })
          ])
        )
        .min(1, "input parts are required")
    ]),
    environment: z.union([environmentConfigSchema, z.string().trim().min(1, "environment is required")]),
    previous_interaction_id: z.preprocess(trimOptional, z.string().optional()),
    system_instruction: z.preprocess(trimOptional, z.string().optional()),
    tools: z.array(toolConfigSchema).optional(),
    store: z.boolean().optional(),
    background: z.boolean().optional(),
    agent_config: agentConfigSchema.optional(),
    generation_config: generationConfigSchema.optional(),
    service_tier: serviceTierSchema.optional()
  })
  .superRefine((request, context) => {
    if (request.background === true && request.store === false) {
      context.addIssue({
        code: "custom",
        path: ["background"],
        message: "background=true requires store=true"
      });
    }
  });

const zodErrors = (error: z.ZodError): string[] =>
  error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });

const compactTransform = (transform?: Record<string, string>): Record<string, string> | undefined => {
  if (!transform) {
    return undefined;
  }
  const entries = Object.entries(transform)
    .map(([key, value]) => [key.trim(), value] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const normalizeSource = (source: EnvironmentSource): EnvironmentSource => {
  if (source.type === "inline") {
    return {
      type: "inline",
      target: source.target.trim(),
      content: source.content
    };
  }
  return {
    type: source.type,
    source: source.source.trim(),
    target: source.target.trim()
  };
};

export const normalizeEnvironmentConfig = (environment: EnvironmentConfig): EnvironmentConfig => {
  const normalized: EnvironmentConfig = {
    type: "remote"
  };

  const sources = environment.sources?.map(normalizeSource).filter(Boolean);
  if (sources?.length) {
    normalized.sources = sources;
  }

  if (environment.network === "disabled") {
    normalized.network = "disabled";
  } else if (environment.network?.allowlist.length) {
    normalized.network = {
      allowlist: environment.network.allowlist.map((rule) => ({
        domain: rule.domain.trim(),
        transform: compactTransform(rule.transform)
      }))
    };
  }

  return normalized;
};

export const normalizeTool = (tool: ToolConfig): ToolConfig =>
  typeof tool === "string" ? { type: tool } : tool;

export const normalizeAgentDefinition = (agent: AgentDefinition): AgentDefinition => {
  const normalized: AgentDefinition = {
    id: agent.id.trim(),
    base_agent: agent.base_agent
  };

  if (agent.description?.trim()) {
    normalized.description = agent.description.trim();
  }
  if (agent.system_instruction?.trim()) {
    normalized.system_instruction = agent.system_instruction.trim();
  }
  if (agent.tools?.length) {
    normalized.tools = agent.tools.map(normalizeTool);
  }
  if (typeof agent.base_environment === "object" && agent.base_environment !== null) {
    normalized.base_environment = normalizeEnvironmentConfig(agent.base_environment);
  } else if (agent.base_environment?.trim()) {
    normalized.base_environment = agent.base_environment.trim();
  }

  return normalized;
};

export const validateAgentDefinition = (
  agent: AgentDefinition
): ApiValidationResult<AgentDefinition> => {
  const result = agentDefinitionSchema.safeParse(agent);
  if (!result.success) {
    return {
      ok: false,
      errors: zodErrors(result.error)
    };
  }
  return {
    ok: true,
    value: normalizeAgentDefinition(result.data),
    errors: []
  };
};

export const validateInteractionCreate = (
  request: InteractionCreateRequest
): ApiValidationResult<InteractionCreateRequest> => {
  const result = interactionCreateSchema.safeParse(request);
  if (!result.success) {
    return {
      ok: false,
      errors: zodErrors(result.error)
    };
  }
  return {
    ok: true,
    value: {
      ...result.data,
      tools: result.data.tools?.map(normalizeTool),
      environment:
        typeof result.data.environment === "object" && result.data.environment !== null
          ? normalizeEnvironmentConfig(result.data.environment)
          : result.data.environment
    },
    errors: []
  };
};
