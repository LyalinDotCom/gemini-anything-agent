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
  agent?: string;
  model?: string;
  input: InteractionInput;
  /** Tools declared on the request; an empty array explicitly sends no tools. */
  toolset?: ToolDecl[];
  previousInteractionId?: string;
  /** Environment id from the previous turn — REQUIRED for continuations. */
  environmentId?: string;
  systemInstruction?: string;
  /** Seed a fresh remote environment with files (degraded/no-managed-agent mode). */
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

  if (p.seedSources && p.seedSources.length > 0) {
    body.environment = { type: "remote", sources: p.seedSources };
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
    if (p.thinkingSummaries && p.thinkingSummaries !== "none") {
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

/** An image input part (uploads/vision). Wire shape from gaicli files.ts. */
export function imagePart(base64Data: string, mimeType: string): Record<string, unknown> {
  return { type: "image", data: base64Data, mime_type: mimeType };
}

export function textPart(text: string): Record<string, unknown> {
  return { type: "text", text };
}
