import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createGenAIClient } from "../genaiClient.js";
import { defaultBaseAgent } from "../models.js";
import { ensureParentDir, resolveOutputPath } from "../output.js";
import type { CommandResult } from "../types.js";

const AGENT_TOOL_TYPES = new Set(["code_execution", "google_search", "url_context"]);

// Interaction statuses that mean the run is finished (successfully or not).
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "incomplete", "budget_exceeded", "expired"]);

type PlainRecord = Record<string, unknown>;
type AgentTool = { type: "code_execution" | "google_search" | "url_context" };

/**
 * SDK responses can carry transport internals (sdkHttpResponse), functions,
 * and bigints that break JSON printing. Reduce to plain JSON-safe data.
 */
const toPlain = <T>(value: unknown, seen = new WeakSet<object>()): T => {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value as T;
  }
  if (typeof value === "bigint") {
    return value.toString() as T;
  }
  if (typeof value !== "object") {
    return undefined as T;
  }
  if (value instanceof Date) {
    return value.toISOString() as T;
  }
  if (seen.has(value)) {
    return undefined as T;
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => toPlain(item, seen)) as T;
    }
    if (value instanceof Map) {
      return Object.fromEntries([...value.entries()].map(([key, item]) => [String(key), toPlain(item, seen)])) as T;
    }
    if (value instanceof Set) {
      return [...value].map((item) => toPlain(item, seen)) as T;
    }
    const plain: PlainRecord = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "sdkHttpResponse" || typeof item === "function" || typeof item === "symbol") {
        continue;
      }
      const normalized = toPlain(item, seen);
      if (normalized !== undefined) {
        plain[key] = normalized;
      }
    }
    return plain as T;
  } finally {
    seen.delete(value);
  }
};

const readTextOption = async (
  inline: string | undefined,
  file: string | undefined,
  label: string
): Promise<string | undefined> => {
  if (inline && file) {
    throw new Error(`Provide ${label} inline or via file, not both.`);
  }
  if (file) {
    const text = (await readFile(resolve(file), "utf8")).trim();
    if (!text) {
      throw new Error(`${label} file ${file} is empty.`);
    }
    return text;
  }
  return inline;
};

const validateTools = (tools: string[] | undefined): AgentTool[] | undefined => {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  for (const tool of tools) {
    if (!AGENT_TOOL_TYPES.has(tool)) {
      throw new Error(
        `Unknown tool "${tool}". Supported tools: ${[...AGENT_TOOL_TYPES].join(", ")}.`
      );
    }
  }
  return [...new Set(tools)].map((tool) => ({ type: tool as AgentTool["type"] }));
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Interaction = {
  id?: string;
  status?: string;
  output_text?: string;
  environment_id?: string;
  usage?: unknown;
  [key: string]: unknown;
};

const interactionSummary = (interaction: Interaction): PlainRecord => ({
  interactionId: interaction.id,
  status: interaction.status,
  environmentId: interaction.environment_id,
  usage: interaction.usage
});

export type AgentCreateOptions = {
  base?: string;
  description?: string;
  system?: string;
  systemFile?: string;
  tool?: string[];
  json?: boolean;
  dryRun?: boolean;
};

export const runAgentCreate = async (id: string, options: AgentCreateOptions): Promise<CommandResult> => {
  const base = options.base || defaultBaseAgent();
  const systemInstruction = await readTextOption(options.system, options.systemFile, "system instruction");
  const tools = validateTools(options.tool);

  const definition: PlainRecord = {
    id,
    base_agent: base,
    ...(options.description ? { description: options.description } : {}),
    ...(systemInstruction ? { system_instruction: systemInstruction } : {}),
    ...(tools ? { tools } : {})
  };

  if (options.dryRun) {
    return {
      ok: true,
      capability: "agent",
      model: base,
      message: "dry run",
      details: { apiSurface: "managed-agent", action: "create", agent: definition }
    };
  }

  const ai = createGenAIClient();
  const created = await ai.agents.create(definition as never);
  return {
    ok: true,
    capability: "agent",
    model: base,
    message: `Created agent ${id}.`,
    details: { action: "create", agent: toPlain(created) }
  };
};

export const runAgentList = async (): Promise<CommandResult> => {
  const ai = createGenAIClient();
  const response = toPlain<{ agents?: PlainRecord[] }>(await ai.agents.list());
  return {
    ok: true,
    capability: "agent",
    message: `${response.agents?.length ?? 0} agent(s).`,
    details: { action: "list", agents: response.agents ?? [] }
  };
};

export const runAgentGet = async (id: string): Promise<CommandResult> => {
  const ai = createGenAIClient();
  const agent = toPlain(await ai.agents.get(id));
  return {
    ok: true,
    capability: "agent",
    details: { action: "get", agent }
  };
};

export const runAgentDelete = async (id: string): Promise<CommandResult> => {
  const ai = createGenAIClient();
  await ai.agents.delete(id);
  return {
    ok: true,
    capability: "agent",
    message: `Deleted agent ${id}.`,
    details: { action: "delete", id }
  };
};

export type AgentRunOptions = {
  env?: string;
  background?: boolean;
  previous?: string;
  system?: string;
  systemFile?: string;
  inputFile?: string;
  out?: string;
  pollInterval?: string;
  timeout?: string;
  json?: boolean;
  dryRun?: boolean;
};

export type AgentWaitOptions = {
  pollInterval?: string;
  timeout?: string;
};

const pollUntilDone = async (
  ai: ReturnType<typeof createGenAIClient>,
  interactionId: string,
  options: AgentWaitOptions
): Promise<Interaction> => {
  const pollSeconds = Number(options.pollInterval || "10");
  const timeoutSeconds = Number(options.timeout || "1800");
  const pollIntervalMs = Math.max(1, (Number.isFinite(pollSeconds) && pollSeconds > 0 ? pollSeconds : 10) * 1000);
  const timeoutMs = Math.max(1000, (Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : 1800) * 1000);
  const startedAt = Date.now();

  while (true) {
    const interaction = toPlain<Interaction>(await ai.interactions.get(interactionId));
    if (!interaction.status || TERMINAL_STATUSES.has(interaction.status)) {
      return interaction;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(
        `Timed out after ${timeoutMs / 1000}s waiting for interaction ${interactionId} (status: ${interaction.status}). It is still running; check it later with: gai agent status ${interactionId}`
      );
    }
    await sleep(pollIntervalMs);
  }
};

const finalizeInteractionResult = async (
  interaction: Interaction,
  agentId: string,
  out: string | undefined
): Promise<CommandResult> => {
  if (interaction.status === "failed") {
    throw new Error(
      `Interaction ${interaction.id} failed: ${JSON.stringify(interaction.error ?? "no error details")}`
    );
  }

  const outputs = [];
  if (out && interaction.output_text) {
    const path = resolve(out);
    await ensureParentDir(path);
    await writeFile(path, `${interaction.output_text}\n`);
    outputs.push({ path, mimeType: "text/plain" });
  }

  return {
    ok: true,
    capability: "agent",
    model: agentId,
    ...(outputs.length > 0 ? { outputs } : {}),
    message: interaction.output_text,
    details: { action: "run", ...interactionSummary(interaction) }
  };
};

export const runAgentRun = async (
  agentId: string,
  prompt: string | undefined,
  options: AgentRunOptions
): Promise<CommandResult> => {
  const input = await readTextOption(prompt, options.inputFile, "input");
  if (!input) {
    throw new Error("Provide an input prompt argument or --input-file.");
  }
  const systemInstruction = await readTextOption(options.system, options.systemFile, "system instruction");
  const environment = options.env || "remote";

  const request: PlainRecord = {
    agent: agentId,
    input,
    environment,
    background: true,
    ...(options.previous ? { previous_interaction_id: options.previous } : {}),
    ...(systemInstruction ? { system_instruction: systemInstruction } : {})
  };

  if (options.dryRun) {
    return {
      ok: true,
      capability: "agent",
      model: agentId,
      message: "dry run",
      details: {
        apiSurface: "managed-agent",
        action: "run",
        request,
        wait: !options.background
      }
    };
  }

  const ai = createGenAIClient();
  const created = toPlain<Interaction>(await ai.interactions.create(request as never));
  if (!created.id) {
    throw new Error("Interaction create response did not include an id.");
  }

  if (options.background) {
    return {
      ok: true,
      capability: "agent",
      model: agentId,
      message: `Interaction ${created.id} started in the background. Check it with: gai agent status ${created.id}`,
      details: { action: "run", ...interactionSummary(created) }
    };
  }

  const done = TERMINAL_STATUSES.has(created.status ?? "")
    ? created
    : await pollUntilDone(ai, created.id, options);
  return finalizeInteractionResult(done, agentId, options.out);
};

export type AgentStatusOptions = AgentWaitOptions & {
  wait?: boolean;
  out?: string;
  json?: boolean;
};

export const runAgentStatus = async (
  interactionId: string,
  options: AgentStatusOptions
): Promise<CommandResult> => {
  const ai = createGenAIClient();
  let interaction = toPlain<Interaction>(await ai.interactions.get(interactionId));
  if (options.wait && interaction.status && !TERMINAL_STATUSES.has(interaction.status)) {
    interaction = await pollUntilDone(ai, interactionId, options);
  }

  if (options.wait) {
    return finalizeInteractionResult(interaction, String(interaction.model ?? ""), options.out);
  }

  return {
    ok: true,
    capability: "agent",
    message: `Interaction ${interactionId} status: ${interaction.status ?? "unknown"}.`,
    details: { action: "status", ...interactionSummary(interaction) }
  };
};

export const runAgentCancel = async (interactionId: string): Promise<CommandResult> => {
  const ai = createGenAIClient();
  const interaction = toPlain<Interaction>(await ai.interactions.cancel(interactionId));
  return {
    ok: true,
    capability: "agent",
    message: `Interaction ${interactionId} cancel requested.`,
    details: { action: "cancel", ...interactionSummary(interaction) }
  };
};

export const runAgentDeleteInteraction = async (interactionId: string): Promise<CommandResult> => {
  const ai = createGenAIClient();
  await ai.interactions.delete(interactionId);
  return {
    ok: true,
    capability: "agent",
    message: `Deleted interaction ${interactionId}.`,
    details: { action: "delete-interaction", interactionId }
  };
};

const execFileAsync = promisify(execFile);

export type EnvironmentTargetOptions = {
  interaction?: string;
};

/**
 * Snapshot commands accept either an environment id positionally or an
 * interaction id via --interaction (resolved through the interaction record,
 * which is what callers usually have after `gai agent run`).
 */
const resolveEnvironmentId = async (
  ai: ReturnType<typeof createGenAIClient>,
  environmentId: string | undefined,
  options: EnvironmentTargetOptions
): Promise<string> => {
  if (environmentId && options.interaction) {
    throw new Error("Provide an environment id or --interaction, not both.");
  }
  if (environmentId) {
    return environmentId;
  }
  if (!options.interaction) {
    throw new Error("Provide an environment id argument or --interaction <interaction-id>.");
  }
  const interaction = toPlain<Interaction>(await ai.interactions.get(options.interaction));
  if (!interaction.environment_id) {
    throw new Error(
      `Interaction ${options.interaction} has no environment_id yet (status: ${interaction.status ?? "unknown"}).`
    );
  }
  return interaction.environment_id;
};

/** Downloads via a partial file + rename so readers never see a truncated tar. */
const downloadSnapshotTar = async (
  ai: ReturnType<typeof createGenAIClient>,
  environmentId: string,
  filePath: string
): Promise<void> => {
  await ensureParentDir(filePath);
  const partialPath = `${filePath}.partial`;
  try {
    await ai.files.download({ file: `environment-${environmentId}`, downloadPath: partialPath } as never);
    await rename(partialPath, filePath);
  } catch (error) {
    await rm(partialPath, { force: true });
    throw error;
  }
};

const listTarEntries = async (tarPath: string): Promise<string[]> => {
  const listed = await execFileAsync("tar", ["-tf", tarPath], { maxBuffer: 64 * 1024 * 1024 });
  return listed.stdout
    .split("\n")
    .map((entry) => entry.trim().replace(/^\.\//, ""))
    .filter((entry) => entry.length > 0 && !entry.endsWith("/"));
};

export type AgentPullOptions = EnvironmentTargetOptions & {
  out?: string;
  extract?: string;
  json?: boolean;
  dryRun?: boolean;
};

export const runAgentPull = async (
  environmentId: string | undefined,
  options: AgentPullOptions
): Promise<CommandResult> => {
  if (options.dryRun) {
    return {
      ok: true,
      capability: "agent",
      message: "dry run",
      details: {
        apiSurface: "managed-agent",
        action: "pull",
        environmentId: environmentId ?? `(resolved from interaction ${options.interaction ?? "?"} at runtime)`,
        extractTo: options.extract
      }
    };
  }

  const ai = createGenAIClient();
  const resolvedId = await resolveEnvironmentId(ai, environmentId, options);
  const tarPath = resolveOutputPath(options.out, `environment-${resolvedId}`, ".tar.gz");
  await downloadSnapshotTar(ai, resolvedId, tarPath);

  const outputs = [{ path: tarPath, mimeType: "application/gzip" }];
  let extractedTo: string | undefined;
  if (options.extract) {
    extractedTo = resolve(options.extract);
    await mkdir(extractedTo, { recursive: true });
    await execFileAsync("tar", ["-xf", tarPath, "-C", extractedTo]);
  }

  return {
    ok: true,
    capability: "agent",
    outputs,
    message: extractedTo
      ? `Environment ${resolvedId} snapshot saved to ${tarPath} and extracted to ${extractedTo}.`
      : `Environment ${resolvedId} snapshot saved to ${tarPath}.`,
    details: { action: "pull", environmentId: resolvedId, ...(extractedTo ? { extractedTo } : {}) }
  };
};

export type AgentLsOptions = EnvironmentTargetOptions & {
  json?: boolean;
};

export const runAgentLs = async (
  environmentId: string | undefined,
  options: AgentLsOptions
): Promise<CommandResult> => {
  const ai = createGenAIClient();
  const resolvedId = await resolveEnvironmentId(ai, environmentId, options);
  const scratch = await mkdtemp(join(tmpdir(), "gai-agent-ls-"));
  const tarPath = join(scratch, "snapshot.tar");
  try {
    await downloadSnapshotTar(ai, resolvedId, tarPath);
    const files = await listTarEntries(tarPath);
    return {
      ok: true,
      capability: "agent",
      message:
        files.length === 0
          ? `Environment ${resolvedId} snapshot is empty.`
          : `${files.length} file(s) in environment ${resolvedId}:\n${files.join("\n")}`,
      details: { action: "ls", environmentId: resolvedId, files }
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
};
