// Client-fulfilled function tools. The controller declares these on every chat turn;
// when the interaction pauses with requires_action + a function_call, the matching
// fulfiller runs in the browser and its result continues the chain (verified live).
// The registry is currently empty (all tools run server-side in the container); it
// remains so client-fulfilled tools can be added without touching the controller.
import type { FunctionToolDecl, ToolDecl } from "../gemini/interactionParams";
import { tools } from "../gemini/interactionParams";

export type FunctionResultPayload =
  | string
  | Array<{ type: "text"; text: string } | { type: "image"; data: string; mime_type: string }>;

export interface FulfillContext {
  sessionId: string;
  signal: AbortSignal;
  /** Fulfillers report display side-effects (e.g. persisted image part) via this hook. */
  onArtifact?: (artifact: { kind: "image"; mediaId: string; mimeType: string; prompt?: string }) => void;
}

export type Fulfiller = (args: Record<string, unknown>, ctx: FulfillContext) => Promise<FunctionResultPayload>;

interface Registered {
  decl: FunctionToolDecl;
  fulfill: Fulfiller;
}

const registry = new Map<string, Registered>();

export function registerFunctionTool(decl: FunctionToolDecl, fulfill: Fulfiller): void {
  registry.set(decl.name, { decl, fulfill });
}

export function getFulfiller(name: string): Fulfiller | null {
  return registry.get(name)?.fulfill ?? null;
}

/** The full toolset for a chat turn: server tools + any registered function tools. */
export function chatToolset(): ToolDecl[] {
  return [tools.codeExecution, tools.googleSearch, tools.urlContext, ...[...registry.values()].map((r) => r.decl)];
}
