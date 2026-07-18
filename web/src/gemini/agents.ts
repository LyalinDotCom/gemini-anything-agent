// Managed-agent lifecycle: ensure-once bootstrap with automatic recreation, conflict
// tolerance (multi-tab races), and a degraded fallback that never blocks chatting.
// The agent description carries a fingerprint of the ENTIRE installed payload
// (the shared repo-root agents/ files + the user's key). Whenever anything changes —
// an app update, a key rotation — the next message transparently deletes and
// recreates the agent. Nothing is ever manually versioned. Wire shapes verified
// live (conflict=409, not_found=404).
import { MODELS } from "../models";
import { ai, resolveApiKey } from "./client";
import { buildEnvSources, payloadFingerprint } from "./envSources";
import { FriendlyError, toFriendly } from "./errors";
import type { InlineSource } from "./interactionParams";
import { tools } from "./interactionParams";

export interface AgentInfo {
  /** Empty string in degraded mode (interactions then target the base agent directly). */
  agentId: string;
  baseAgent: string;
  /** Fingerprint of the payload this agent was created with. */
  payloadFingerprint: string;
  createdAt: number;
  verifiedAt: number;
  degraded: boolean;
  /** What the last ensure actually did — feeds the session-start narration. */
  action?: "created" | "recreated" | "reused" | "degraded";
}

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

function currentPayload(): { sources: InlineSource[]; fingerprint: string } {
  const key = resolveApiKey();
  if (!key) throw new FriendlyError("no-key", "No Gemini API key set.");
  const sources = buildEnvSources(key);
  // Fingerprint the deployed definition as well as mounted files. Otherwise an
  // existing agent created before tools were declared would look current forever.
  const definitionSignature: InlineSource = {
    type: "inline",
    target: "@managed-agent-definition",
    content: `${MODELS.chatAgentBase}\ncode_execution\ngoogle_search\nurl_context`,
  };
  return { sources, fingerprint: payloadFingerprint([...sources, definitionSignature]) };
}

function descriptionFor(agentId: string, fingerprint: string): string {
  const role = agentId.includes("browser") ? "browser testing" : "anything";
  return `gemini-anything web ${role} managed agent (payload-${fingerprint})`;
}

function fingerprintFromDescription(description: unknown): string | null {
  const m = String(description ?? "").match(/payload-([0-9a-f]+)/);
  return m ? m[1] : null;
}

function healthy(
  agentId: string,
  fingerprint: string,
  action: NonNullable<AgentInfo["action"]>,
  createdAt?: number,
): AgentInfo {
  const now = Date.now();
  return {
    agentId,
    baseAgent: MODELS.chatAgentBase,
    payloadFingerprint: fingerprint,
    createdAt: createdAt ?? now,
    verifiedAt: now,
    degraded: false,
    action,
  };
}

function degraded(fingerprint: string): AgentInfo {
  const now = Date.now();
  return {
    agentId: "",
    baseAgent: MODELS.chatAgentBase,
    payloadFingerprint: fingerprint,
    createdAt: now,
    verifiedAt: now,
    degraded: true,
    action: "degraded",
  };
}

async function createAgent(agentId: string, sources: InlineSource[], fingerprint: string): Promise<void> {
  // No agent-level system_instruction: it shares ONE slot with request-level
  // instructions (any per-request injection would silently displace it), and the
  // base agent reads /.agents/AGENTS.md on its own — that's the durable layer.
  await ai().agents.create({
    id: agentId,
    base_agent: MODELS.chatAgentBase,
    description: descriptionFor(agentId, fingerprint),
    tools: [tools.codeExecution, tools.googleSearch, tools.urlContext],
    base_environment: { type: "remote", sources },
  } as never);
}

/**
 * Ensure a managed agent with the CURRENT payload exists under this key.
 * Never throws for availability problems — returns a degraded AgentInfo instead.
 * DOES throw FriendlyError("bad-key"/"no-key") so the UI can send the user to Settings.
 */
// Google-reserved id prefixes (mirrors the Electron sdk's validation list). The
// API rejects creating these with a generic 400, so an ensure would delete an
// existing agent it can never replace — e.g. the pre-rename "gemini-anything-v1".
const RESERVED_AGENT_ID =
  /^(antigravity|veo|omni|lyria|imagen|gemma|gemini|google|youtube|android|chrome|pixel|waze|fitbit|nest|kaggle)-/i;

export async function ensureAgent(agentId: string, current: AgentInfo | null, force = false): Promise<AgentInfo> {
  const { sources, fingerprint } = currentPayload();

  // Never delete or deploy over an id we cannot recreate.
  if (RESERVED_AGENT_ID.test(agentId.trim())) return degraded(fingerprint);

  if (
    !force &&
    current &&
    !current.degraded &&
    current.agentId === agentId &&
    current.payloadFingerprint === fingerprint &&
    Date.now() - current.verifiedAt < VERIFY_TTL_MS
  ) {
    return { ...current, action: "reused" };
  }

  // 1) Look for the existing agent and compare its payload fingerprint.
  let existedBefore = false;
  try {
    const got = (await ai().agents.get(agentId)) as Record<string, unknown>;
    if (fingerprintFromDescription(got?.description) === fingerprint) {
      return healthy(agentId, fingerprint, "reused", current?.createdAt);
    }
    // Payload changed (app update or key rotation) → recreate transparently.
    existedBefore = true;
    try {
      await ai().agents.delete(agentId);
    } catch (e) {
      if (toFriendly(e).kind !== "not-found") throw e;
    }
  } catch (e) {
    const f = toFriendly(e);
    if (f.kind === "bad-key" || f.kind === "no-key") throw f;
    if (f.kind !== "not-found") {
      // Network/server trouble: stale-ok if we have anything, else degrade.
      if (current && !current.degraded) return { ...current, action: "reused" };
      return degraded(fingerprint);
    }
  }

  // 2) Create (tolerating a concurrent tab winning the race).
  try {
    await createAgent(agentId, sources, fingerprint);
    return healthy(agentId, fingerprint, existedBefore ? "recreated" : "created");
  } catch (e) {
    const f = toFriendly(e);
    if (f.kind === "conflict") {
      return healthy(agentId, fingerprint, "reused", current?.createdAt);
    }
    if (f.kind === "bad-key" || f.kind === "no-key") throw f;
    return degraded(fingerprint);
  }
}

const inflight = new Map<string, Promise<AgentInfo>>();

/** Ensure either app-owned custom profile without mixing concurrent profile requests. */
export function ensureManagedAgent(agentId: string, current: AgentInfo | null, force = false): Promise<AgentInfo> {
  const existing = inflight.get(agentId);
  if (existing) return existing;
  const pending = ensureAgent(agentId, current?.agentId === agentId ? current : null, force).finally(() => {
    inflight.delete(agentId);
  });
  inflight.set(agentId, pending);
  return pending;
}

// Deliberately NO listAgents here: this sample manages exactly ONE agent by name.
// A user's key may carry agents from entirely different projects — we never
// enumerate or touch them.
export async function deleteAgent(agentId: string): Promise<void> {
  try {
    await ai().agents.delete(agentId);
  } catch (e) {
    if (toFriendly(e).kind !== "not-found") throw toFriendly(e);
  }
}
