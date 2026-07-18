import { config as loadEnv } from "dotenv";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  ANTIGRAVITY_BASE_AGENT,
  GeminiManagedAgentsClient,
  extractInteractionOutputText,
  type AgentDefinition,
  type Interaction,
} from "../src/sdk";

const execFileAsync = promisify(execFile);
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(APP_ROOT, "..");
const AGENTS_ROOT = join(REPO_ROOT, "agents");

loadEnv({ path: join(REPO_ROOT, ".env") });
loadEnv({ path: join(APP_ROOT, ".env"), override: true });

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  throw new Error("GEMINI_API_KEY is required in the repo-root or app .env file.");
}

const client = new GeminiManagedAgentsClient({
  apiKey,
  baseUrl: process.env.GEMINI_API_BASE_URL,
  apiRevision: process.env.GEMINI_API_REVISION,
});

const readAgentAsset = (path: string): Promise<string> => readFile(join(AGENTS_ROOT, path), "utf8");
const sleep = (ms: number): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const terminal = new Set(["succeeded", "failed", "cancelled", "canceled", "completed"]);

async function waitForInteraction(initial: Interaction): Promise<Interaction> {
  let interaction = initial;
  const deadline = Date.now() + 10 * 60_000;
  while (!terminal.has(interaction.status?.toLowerCase() ?? "")) {
    if (Date.now() >= deadline) throw new Error("Browser smoke interaction timed out after 10 minutes.");
    await sleep(3_000);
    interaction = await client.getInteraction(interaction.id);
  }
  if (["failed", "cancelled", "canceled"].includes(interaction.status?.toLowerCase() ?? "")) {
    throw new Error(`Browser smoke interaction ended with status ${interaction.status}.`);
  }
  if (!interaction.environment_id) throw new Error("Browser smoke interaction returned no environment_id.");
  return interaction;
}

async function buildDefinition(id: string): Promise<AgentDefinition> {
  const [agentsMd, gai, mediaSkill, browser, browserSkill] = await Promise.all([
    readAgentAsset("AGENTS.md"),
    readAgentAsset("bin/gai"),
    readAgentAsset("skills/gemini-anything/SKILL.md"),
    readAgentAsset("bin/browser"),
    readAgentAsset("skills/browser-testing/SKILL.md"),
  ]);
  return {
    id,
    description: "Ephemeral live smoke test for the shared headless-browser agent payload.",
    base_agent: ANTIGRAVITY_BASE_AGENT,
    tools: [{ type: "code_execution" }, { type: "google_search" }, { type: "url_context" }],
    base_environment: {
      type: "remote",
      sources: [
        { type: "inline", target: ".agents/AGENTS.md", content: agentsMd },
        { type: "inline", target: ".agents/bin/gai", content: gai },
        { type: "inline", target: ".agents/bin/browser", content: browser },
        { type: "inline", target: ".agents/skills/gemini-anything/SKILL.md", content: mediaSkill },
        { type: "inline", target: ".agents/skills/browser-testing/SKILL.md", content: browserSkill },
      ],
    },
  };
}

const id = `browser-poc-${Date.now().toString(36)}`;
let interactionId: string | undefined;
const tempRoot = await mkdtemp(join(tmpdir(), "gemini-browser-smoke-"));

try {
  await client.createAgent(await buildDefinition(id));
  const created = await client.createInteraction({
    agent: id,
    environment: "remote",
    store: true,
    background: true,
    input: [
      "Use the mounted browser-testing skill and `bash /.agents/bin/browser` to test https://demo.playwright.dev/todomvc/ in a named headless session.",
      "Add exactly two todos named `Buy groceries` and `Water flowers`, mark only `Buy groceries` complete, and verify with a precise browser-side assertion that there are exactly 2 todos and exactly 1 completed todo.",
      "Save a full-page screenshot to /workspace/output/browser/todomvc-smoke.png.",
      "Write /workspace/output/browser/todomvc-smoke.json containing the final URL, page title, todoCount, completedCount, and screenshot path.",
      "Verify both files exist and are nonempty, close the browser session, and report the assertion results and paths. Do not merely describe commands; execute the full flow.",
    ].join(" "),
  });
  interactionId = created.id;
  const interaction = await waitForInteraction(created);

  const snapshot = join(tempRoot, "snapshot.tar");
  await client.downloadEnvironmentSnapshotTo(interaction.environment_id!, snapshot);
  const { stdout } = await execFileAsync("tar", ["-tf", snapshot], { maxBuffer: 10 * 1024 * 1024 });
  const entries = stdout.split("\n").filter(Boolean);
  const transientCacheEntries = entries.filter((entry) =>
    /(?:^|\/)(?:\.npm-cache|ms-playwright)(?:\/|$)/.test(entry)
  );
  if (transientCacheEntries.length) {
    throw new Error(
      `Transient browser caches leaked into the workspace snapshot: ${JSON.stringify(transientCacheEntries.slice(0, 20))}`
    );
  }
  const screenshotEntry = entries.find((entry) => entry.endsWith("output/browser/todomvc-smoke.png"));
  const reportEntry = entries.find((entry) => entry.endsWith("output/browser/todomvc-smoke.json"));
  if (!screenshotEntry || !reportEntry) {
    const outputEntries = entries.filter((entry) => entry.includes("output/")).slice(0, 50);
    throw new Error(
      `Browser smoke artifacts are missing from the environment snapshot. Agent output: ${extractInteractionOutputText(interaction) ?? "<none>"}. Output entries: ${JSON.stringify(outputEntries)}`
    );
  }
  for (const entry of [screenshotEntry, reportEntry]) {
    if (entry.startsWith("/") || entry.split("/").includes("..")) throw new Error(`Unsafe snapshot entry: ${entry}`);
  }
  await execFileAsync("tar", ["-xf", snapshot, "-C", tempRoot, screenshotEntry, reportEntry]);

  const screenshot = await readFile(join(tempRoot, screenshotEntry));
  if (screenshot.length < 8 || screenshot.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("Browser smoke screenshot is not a valid nonempty PNG.");
  }
  const report = JSON.parse(await readFile(join(tempRoot, reportEntry), "utf8")) as Record<string, unknown>;
  if (report.todoCount !== 2 || report.completedCount !== 1) {
    throw new Error(`Browser smoke assertions failed: ${JSON.stringify(report)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    agent: id,
    interaction: interaction.id,
    environment: interaction.environment_id,
    output: extractInteractionOutputText(interaction),
    report,
    screenshotBytes: screenshot.length,
    snapshotBytes: (await stat(snapshot)).size,
    artifacts: [basename(screenshotEntry), basename(reportEntry)],
  }, null, 2));
} finally {
  if (interactionId) await client.deleteInteraction(interactionId).catch(() => undefined);
  await client.deleteAgent(id).catch(() => undefined);
  await rm(tempRoot, { recursive: true, force: true });
}
