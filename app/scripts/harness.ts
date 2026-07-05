import { config as loadEnv } from "dotenv";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  ANTIGRAVITY_BASE_AGENT,
  GeminiManagedAgentsClient,
  createStarterAgentDefinition,
  extractInteractionOutputText,
  validateAgentDefinition,
  type AgentDefinition,
  type Interaction,
  type InteractionCreateRequest
} from "../src/sdk";

loadEnv();
loadEnv({ path: ".env.local", override: true });

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    scenario: { type: "string", short: "s" },
    id: { type: "string" },
    agent: { type: "string" },
    input: { type: "string" },
    live: { type: "boolean" },
    dry: { type: "boolean" },
    yes: { type: "boolean" },
    keep: { type: "boolean" },
    replace: { type: "boolean" },
    "snapshot-out": { type: "string" },
    help: { type: "boolean", short: "h" }
  }
});

type Scenario =
  | "preview"
  | "create"
  | "list"
  | "get"
  | "delete"
  | "invoke"
  | "first"
  | "smoke"
  | "snapshot";

const scenario = ((values.scenario ?? positionals[0] ?? "preview") as Scenario).toLowerCase() as Scenario;
const live = Boolean((values.live || process.env.GEMINI_LIVE_TEST === "1") && !values.dry);
const id =
  values.id ??
  `agent-lab-${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 12)}`;

const client = new GeminiManagedAgentsClient({
  apiKey: process.env.GEMINI_API_KEY,
  baseUrl: process.env.GEMINI_API_BASE_URL,
  apiRevision: process.env.GEMINI_API_REVISION
});

const parsedTimeout = Number(process.env.GEMINI_HARNESS_TIMEOUT_MS ?? 300_000);
const HARNESS_TIMEOUT_MS = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 300_000;

const usage = () => {
  console.log(`Gemini managed-agent harness

Usage:
  npm run harness -- preview --id agent-lab-demo
  npm run harness -- create --id agent-lab-demo --live
  npm run harness -- list --live
  npm run harness -- get --id agent-lab-demo --live
  npm run harness -- invoke --agent agent-lab-demo --input "Inspect /workspace" --live
  npm run harness -- first --live
  npm run harness -- smoke --live
  npm run harness -- delete --id agent-lab-demo --live --yes

Defaults:
  Calls are dry-run previews unless --live or GEMINI_LIVE_TEST=1 is set.
  The smoke scenario deletes the managed test agent unless --keep is set.
`);
};

const printJson = (label: string, value: unknown) => {
  console.log(`\n${label}`);
  console.log(JSON.stringify(value, null, 2));
};

const validateOrThrow = (agent: AgentDefinition): AgentDefinition => {
  const validation = validateAgentDefinition(agent);
  if (!validation.ok) {
    throw new Error(validation.errors.join("\n"));
  }
  return validation.value;
};

const createPayload = (): AgentDefinition => validateOrThrow(createStarterAgentDefinition(id));

const requireLive = () => {
  if (!live) {
    console.log("Dry run. Add --live or set GEMINI_LIVE_TEST=1 to call the API.");
    return false;
  }
  return true;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isTerminalInteraction = (interaction: Interaction): boolean => {
  if (extractInteractionOutputText(interaction)) {
    return true;
  }
  const status = interaction.status?.toLowerCase();
  return Boolean(status && ["succeeded", "failed", "cancelled", "canceled", "completed"].includes(status));
};

const assertSucceeded = (interaction: Interaction, label: string): void => {
  const status = interaction.status?.toLowerCase();
  if (status && ["failed", "cancelled", "canceled"].includes(status)) {
    throw new Error(`${label} ended with status ${interaction.status}.`);
  }
  if (!interaction.environment_id) {
    throw new Error(`${label} did not return environment_id.`);
  }
};

const summarizeInteraction = (interaction: Interaction) => {
  const outputText = extractInteractionOutputText(interaction);
  return {
    id: interaction.id,
    status: interaction.status ?? (outputText ? "succeeded" : "unknown"),
    environment_id: interaction.environment_id ?? null,
    output_text: outputText
      ? outputText.length > 600
        ? `${outputText.slice(0, 600)}...`
        : outputText
      : null,
    steps: Array.isArray(interaction.steps) ? interaction.steps.length : 0
  };
};

const createAndWaitInteraction = async (
  request: InteractionCreateRequest,
  label: string
): Promise<Interaction> => {
  const startedAt = Date.now();
  let interaction = await client.createInteraction(request);
  let delayMs = 2_000;

  let pollFailures = 0;
  while (
    interaction.id &&
    !isTerminalInteraction(interaction) &&
    Date.now() - startedAt < HARNESS_TIMEOUT_MS
  ) {
    await sleep(delayMs);
    try {
      interaction = await client.getInteraction(interaction.id);
      pollFailures = 0;
    } catch (error) {
      // A transient poll failure must not abandon a possibly-succeeding run.
      pollFailures += 1;
      if (pollFailures >= 3) {
        throw error;
      }
    }
    delayMs = Math.min(Math.round(delayMs * 1.5), 10_000);
  }

  if (!isTerminalInteraction(interaction)) {
    throw new Error(`${label} did not finish within ${HARNESS_TIMEOUT_MS}ms.`);
  }

  assertSucceeded(interaction, label);
  printJson(label, summarizeInteraction(interaction));
  return interaction;
};

const deleteQuietly = async (kind: string, target: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
    console.log(`Deleted ${kind} ${target}.`);
  } catch (error) {
    console.warn(`Could not delete ${kind} ${target}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const run = async () => {
  if (values.help) {
    usage();
    return;
  }

  if (scenario === "preview") {
    printJson("Validated create payload", createPayload());
    return;
  }

  if (scenario === "create") {
    const payload = createPayload();
    if (!requireLive()) {
      printJson("Create payload", payload);
      return;
    }
    printJson("Created agent", await client.createAgent(payload));
    return;
  }

  if (scenario === "list") {
    if (!requireLive()) {
      return;
    }
    printJson("Agents", await client.listAgents());
    return;
  }

  if (scenario === "get") {
    if (!requireLive()) {
      console.log(`Would fetch agent ${id}.`);
      return;
    }
    printJson("Agent", await client.getAgent(id));
    return;
  }

  if (scenario === "delete") {
    if (!values.yes) {
      throw new Error("Deletion requires --yes.");
    }
    if (!requireLive()) {
      console.log(`Would delete agent ${id}.`);
      return;
    }
    await client.deleteAgent(id);
    console.log(`Deleted ${id}.`);
    return;
  }

  if (scenario === "invoke") {
    const agent = values.agent ?? id;
    const input = values.input ?? "Inspect the workspace and summarize the current files.";
    const request: InteractionCreateRequest = {
      agent,
      input,
      environment: "remote",
      store: true
    };
    if (!requireLive()) {
      printJson("Interaction request", request);
      return;
    }
    await createAndWaitInteraction(request, "Interaction");
    return;
  }

  if (scenario === "first") {
    const request: InteractionCreateRequest = {
      agent: ANTIGRAVITY_BASE_AGENT,
      input:
        values.input ??
        "Inspect the workspace and propose a concise first task plan. Include the current working directory.",
      environment: "remote",
      store: true
    };
    if (!requireLive()) {
      printJson("First interaction request", request);
      return;
    }
    const interaction = await createAndWaitInteraction(request, "First interaction");
    if (!values.keep) {
      await deleteQuietly("interaction", interaction.id, () => client.deleteInteraction(interaction.id));
    }
    return;
  }

  if (scenario === "smoke") {
    const managedAgentId = id;
    const cleanupInteractionIds: string[] = [];
    let createdAgent = false;

    const firstRequest: InteractionCreateRequest = {
      agent: ANTIGRAVITY_BASE_AGENT,
      input:
        "Create /workspace/managed-agent-smoke.txt containing the words smoke test ready, then report the absolute path.",
      environment: "remote",
      store: true
    };
    const createRequest = createPayload();
    const invokeRequest: InteractionCreateRequest = {
      agent: managedAgentId,
      input:
        values.input ??
        "Inspect the workspace, create /workspace/managed-agent-smoke.txt containing managed smoke ready, and propose a first task plan.",
      environment: "remote",
      store: true
    };

    if (!requireLive()) {
      printJson("First interaction request", firstRequest);
      printJson("Create payload", createRequest);
      printJson("Managed interaction request", invokeRequest);
      return;
    }

    try {
      const baseInteraction = await createAndWaitInteraction(firstRequest, "Base agent smoke");
      cleanupInteractionIds.push(baseInteraction.id);

      if (values.replace) {
        await deleteQuietly("agent", managedAgentId, () => client.deleteAgent(managedAgentId));
      }

      const created = await client.createAgent(createRequest);
      createdAgent = true;
      printJson("Created managed agent", {
        id: created.id,
        base_agent: created.base_agent,
        has_base_environment: Boolean(created.base_environment)
      });

      const managedInteraction = await createAndWaitInteraction(invokeRequest, "Managed agent smoke");
      cleanupInteractionIds.push(managedInteraction.id);

      const continuationRequest: InteractionCreateRequest = {
        agent: managedAgentId,
        input: "Continue in the same sandbox. Read /workspace/managed-agent-smoke.txt if it exists, then summarize the result.",
        environment: managedInteraction.environment_id!,
        previous_interaction_id: managedInteraction.id,
        store: true
      };
      const continuation = await createAndWaitInteraction(continuationRequest, "Continuation smoke");
      cleanupInteractionIds.push(continuation.id);
    } finally {
      if (!values.keep) {
        for (const interactionId of cleanupInteractionIds.reverse()) {
          await deleteQuietly("interaction", interactionId, () => client.deleteInteraction(interactionId));
        }
        if (createdAgent) {
          await deleteQuietly("agent", managedAgentId, () => client.deleteAgent(managedAgentId));
        }
      }
    }
    return;
  }

  if (scenario === "snapshot") {
    const environmentId = values.id;
    if (!environmentId) {
      throw new Error("snapshot requires --id <environment_id>.");
    }
    if (!requireLive()) {
      console.log(`Would download snapshot for ${environmentId}.`);
      return;
    }
    const out = values["snapshot-out"] ?? "snapshot_env.tar";
    await client.downloadEnvironmentSnapshotTo(environmentId, out);
    console.log(`Wrote ${out}.`);
    return;
  }

  usage();
  throw new Error(`Unknown scenario: ${scenario}`);
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
