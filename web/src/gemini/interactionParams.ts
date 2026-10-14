import { MODELS } from "../models";
// Request-body builder for /interactions calls. Ports the semantics of
// gemini-api-cli src/lib/api.ts buildInteractionRequest (env auto-"remote" for agents,
// deep-research auto-config) plus a live-verified API rule: continuation requests MUST
// carry the environment id from the previous turn.

export interface FunctionToolDecl {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export type ToolDecl =
  | { type: "code_execution" }
  | { type: "google_search" }
  | { type: "url_context" }
  | { type: "mcp_server"; name: string; url: string; credential?: string; headers?: Record<string, string>; allowed_tools?: string[] }
  | FunctionToolDecl;

export const tools = {
  codeExecution: { type: "code_execution" } as ToolDecl,
  googleSearch: { type: "google_search" } as ToolDecl,
  urlContext: { type: "url_context" } as ToolDecl,
  fn(name: string, description: string, parameters: Record<string, unknown>): FunctionToolDecl {
    return { type: "function", name, description, parameters };
  },
};

/** Input: plain text or an array of content/step parts (image parts, function_result, …). */
export type InteractionInput = string | Array<Record<string, unknown>>;

export interface InlineSource {
  type: "inline";
  target: string;
  content: string;
}

export interface TurnParams {
  agentModel?: string;
  agent?: string;
  model?: string;
  input: InteractionInput;
  /** Tools declared on the request; an empty array explicitly sends no tools. */
  toolset?: ToolDecl[];
  previousInteractionId?: string;
  /** Environment id from the previous turn — REQUIRED for continuations. */
  environmentId?: string;
  /** Credential references and network rules; combined with the existing environment ID on continuation. */
  environmentConfig?: {
    network?: "disabled" | { allowlist: Array<{ domain: string; credential?: string; transform?: Record<string, string> }> };
    env?: Record<string, string | { value: string } | { credential: string }>;
  };
  systemInstruction?: string;
  /** Mount payload or input files, preserving an existing environment when supplied. */
  seedSources?: InlineSource[];
  deepResearch?: boolean;
  store?: boolean;
  background?: boolean;
  serviceTier?: "standard" | "flex" | "priority";
  thinkingSummaries?: "none" | "auto";
  stream: boolean;
}

export function buildInteractionParams(p: TurnParams): Record<string, unknown> {
  const body: Record<string, unknown> = { input: p.input, stream: p.stream };

  if (p.model) body.model = p.model;
  if (p.agent) body.agent = p.agent;

  if ((p.seedSources && p.seedSources.length > 0) || p.environmentConfig) {
    body.environment = {
      type: "remote",
      ...(p.environmentId ? { environment_id: p.environmentId } : {}),
      ...(p.seedSources?.length ? { sources: p.seedSources } : {}),
      ...p.environmentConfig,
    };
  } else if (p.environmentId) {
    body.environment = p.environmentId;
  } else if (p.agent && !p.deepResearch) {
    body.environment = "remote";
  }

  if (p.systemInstruction) body.system_instruction = p.systemInstruction;
  if (p.toolset) body.tools = p.toolset;
  if (p.previousInteractionId) body.previous_interaction_id = p.previousInteractionId;

  if (!p.deepResearch) {
    if (p.store !== undefined) body.store = p.store;
    if (p.background && p.store !== false) body.background = true;
    if (p.serviceTier && p.serviceTier !== "standard") body.service_tier = p.serviceTier;
    if (p.agent === MODELS.chatAgentBase && p.agentModel) {
      body.agent_config = { type: "antigravity", model: p.agentModel };
    } else if (p.agent === MODELS.chatAgentBase && p.thinkingSummaries && p.thinkingSummaries !== "none") {
      body.agent_config = { type: "dynamic", thinking_summaries: p.thinkingSummaries };
    }
  }

  if (p.deepResearch) {
    body.background = true;
    body.store = true; // background runs must be stored to be reattachable/pollable
    body.agent_config = {
      type: "deep-research",
      thinking_summaries: p.thinkingSummaries === "none" ? "auto" : (p.thinkingSummaries ?? "auto"),
    };
  }

  return body;
}

/** A function_result input part continuing a requires_action interaction (verified live: omitting it is a 400). */
export function functionResultPart(
  callId: string,
  name: string,
  result: string | Array<{ type: "text"; text: string } | { type: "image"; data: string; mime_type: string }>,
): Record<string, unknown> {
  return { type: "function_result", call_id: callId, name, result };
}

/** An image input part (uploads/vision). Uses the Interactions API input shape. */
export function imagePart(base64Data: string, mimeType: string): Record<string, unknown> {
  return { type: "image", data: base64Data, mime_type: mimeType };
}

export function textPart(text: string): Record<string, unknown> {
  return { type: "text", text };
}
