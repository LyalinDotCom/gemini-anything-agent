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
import { OBJECT3D_AGENT_ID } from "../../../shared/object3dProfile";

export interface AgentInfo {
  /** Empty string in degraded mode (interactions then target the base agent directly). */
  agentId: string;
  baseAgent: string;
  reasoningModel?: string;
  /** Fingerprint of the payload this agent was created with. */
  payloadFingerprint: string;
  createdAt: number;
  verifiedAt: number;
  degraded: boolean;
  /** What the last ensure actually did — feeds the session-start narration. */
  action?: "created" | "recreated" | "reused" | "degraded";
}

// Cached metadata cannot prove an agent still exists after deletion in another tab.
const VERIFY_TTL_MS = 0;

function agentDefinitionSignature(model: string): string { return `${MODELS.chatAgentBase}\n${model}\ncode_execution\ngoogle_search\nurl_context`; }

export function agentWorkflowFingerprint(model: string, profileId: string): string {
  return payloadFingerprint([...buildEnvSources(resolveApiKey() ?? "REDACTED"), {type:"inline",target:"@managed-agent-definition",content:agentDefinitionSignature(model)}, {type:"inline",target:"@profile",content:profileId}]);
}

function currentPayload(model = MODELS.text as string): { sources: InlineSource[]; fingerprint: string } {
  const key = resolveApiKey();
  if (!key) throw new FriendlyError("no-key", "No Gemini API key set.");
  const sources = buildEnvSources(key);
  // Fingerprint the deployed definition as well as mounted files. Otherwise an
  // existing agent created before tools were declared would look current forever.
  const definitionSignature: InlineSource = {
    type: "inline",
    target: "@managed-agent-definition",
    content: agentDefinitionSignature(model),
  };
  return { sources, fingerprint: payloadFingerprint([...sources, definitionSignature]) };
}

function descriptionFor(agentId: string, fingerprint: string): string {
  const role = agentId.startsWith(OBJECT3D_AGENT_ID) ? "photo-to-3D object" : agentId.includes("browser") ? "browser testing" : agentId.includes("large-image") ? "large images" : "anywhere";
  return `Gemini Anywhere Agent (GAA) web ${role} managed agent (payload-${fingerprint})`;
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
  reasoningModel: string = MODELS.text,
): AgentInfo {
  const now = Date.now();
  return {
    agentId,
    baseAgent: MODELS.chatAgentBase,
    reasoningModel,
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

async function createAgent(client: ReturnType<typeof ai>, agentId: string, sources: InlineSource[], fingerprint: string, model: string): Promise<void> {
  // No agent-level system_instruction: it shares ONE slot with request-level
  // instructions (any per-request injection would silently displace it), and the
  // base agent reads /.agents/AGENTS.md on its own — that's the durable layer.
  await client.agents.create({
    id: agentId,
    base_agent: MODELS.chatAgentBase,
    agent_config: { type: "antigravity", model },
    description: descriptionFor(agentId, fingerprint),
    tools: [tools.codeExecution, tools.googleSearch, tools.urlContext],
    base_environment: { type: "remote", sources },
  } as never, { maxRetries: 0 });
}

/**
 * Ensure a managed agent with the CURRENT payload exists under this key.
 * Never throws for availability problems — returns a degraded AgentInfo instead.
 * DOES throw FriendlyError("bad-key"/"no-key") so the UI can send the user to Settings.
 */
// Google-reserved id prefixes (mirrors the Electron sdk's validation list). The
// API rejects creating these with a generic 400, so an ensure would delete an
// existing agent it can never replace.
const RESERVED_AGENT_ID =
  /^(antigravity|veo|omni|lyria|imagen|gemma|gemini|google|youtube|android|chrome|pixel|waze|fitbit|nest|kaggle)-/i;

export async function ensureAgent(agentId: string, current: AgentInfo | null, force = false, model: string = MODELS.text): Promise<AgentInfo> {
  const { sources, fingerprint } = currentPayload(model);
  const client = ai();

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
    const got = (await client.agents.get(agentId)) as Record<string, unknown>;
    if (fingerprintFromDescription(got?.description) === fingerprint) {
      return healthy(agentId, fingerprint, "reused", current?.createdAt, model);
    }
    // Payload changed (app update or key rotation) → recreate transparently.
    existedBefore = true;
    try {
      await client.agents.delete(agentId);
    } catch (e) {
      if (toFriendly(e).kind !== "not-found") throw e;
    }
  } catch (e) {
    const f = toFriendly(e);
    if (f.kind === "bad-key" || f.kind === "no-key" || f.kind === "bad-request") throw f;
    if (f.kind !== "not-found") {
      // Network/server trouble: stale-ok if we have anything, else degrade.
      if (!existedBefore && current && !current.degraded && current.agentId === agentId && current.payloadFingerprint === fingerprint) return { ...current, action: "reused" };
      return degraded(fingerprint);
    }
  }

  // 2) Create (tolerating a concurrent tab winning the race).
  try {
    await createAgent(client, agentId, sources, fingerprint, model);
    return healthy(agentId, fingerprint, existedBefore ? "recreated" : "created", undefined, model);
  } catch (e) {
    const f = toFriendly(e);
    if (f.kind === "conflict") {
      try {
        const winner = await client.agents.get(agentId) as Record<string,unknown>;
        return fingerprintFromDescription(winner.description) === fingerprint ? healthy(agentId, fingerprint, "reused", current?.createdAt, model) : degraded(fingerprint);
      } catch (error) {
        const failure = toFriendly(error);
        if (["bad-key", "no-key", "bad-request"].includes(failure.kind)) throw failure;
        return degraded(fingerprint);
      }
    }
    if (f.kind === "bad-key" || f.kind === "no-key" || f.kind === "bad-request") throw f;
    return degraded(fingerprint);
  }
}

const inflight = new Map<string, Promise<AgentInfo>>();
const verifiedAgents = new Map<string, AgentInfo>();

/** Ensure either app-owned custom profile without mixing concurrent profile requests. */
export function managedAgentId(agentId: string, model: string = MODELS.text): string {
  const suffix = model.replace(/^gemini-/, "").toLowerCase().replace(/[^a-z0-9-]+/g,"-");
  return model === MODELS.text || agentId.endsWith(`-${suffix}`) ? agentId : `${agentId}-${suffix}`;
}

export async function ensureManagedAgent(baseId: string, current: AgentInfo | null, force = false, model: string = MODELS.text): Promise<AgentInfo> {
  const agentId = managedAgentId(baseId, model);
  const inflightKey = `${agentId}:${model}:${currentPayload(model).fingerprint}`;
  const existing = inflight.get(inflightKey);
  if (existing) return existing;
  const pending = ensureAgent(agentId, current?.agentId === agentId ? current : verifiedAgents.get(inflightKey) ?? null, force, model).then(info => { if (!info.degraded) verifiedAgents.set(inflightKey, info); return info; }).finally(() => {
    inflight.delete(inflightKey);
  });
  inflight.set(inflightKey, pending);
  return pending;
}

// Deliberately NO listAgents here: this sample manages exactly ONE agent by name.
// A user's key may carry agents from entirely different projects — we never
// enumerate or touch them.
export async function deleteAgent(agentId: string): Promise<void> {
  const client = ai();
  try {
    await client.agents.delete(agentId);
  } catch (e) {
    if (toFriendly(e).kind !== "not-found") throw toFriendly(e);
  }
  for (const key of verifiedAgents.keys()) {
    if (key.startsWith(`${agentId}:`)) verifiedAgents.delete(key);
  }
}
