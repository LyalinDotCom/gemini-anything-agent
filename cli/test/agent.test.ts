import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runAgentCancel,
  runAgentCreate,
  runAgentDelete,
  runAgentDeleteInteraction,
  runAgentGet,
  runAgentList,
  runAgentLs,
  runAgentPull,
  runAgentRun,
  runAgentStatus
} from "../src/subcommands/agent.js";

const execFileAsync = promisify(execFile);

const genai = vi.hoisted(() => ({
  agents: {
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    delete: vi.fn()
  },
  interactions: {
    create: vi.fn(),
    get: vi.fn(),
    cancel: vi.fn(),
    delete: vi.fn()
  },
  files: {
    download: vi.fn()
  }
}));

/** Builds a real snapshot tar with /workspace-style contents for ls/pull tests. */
const makeSnapshotTar = async (dir: string): Promise<string> => {
  const treeRoot = join(dir, "tree");
  await mkdir(join(treeRoot, "output"), { recursive: true });
  await writeFile(join(treeRoot, "notes.txt"), "hello");
  await writeFile(join(treeRoot, "output", "report.md"), "# report");
  const tarPath = join(dir, "snapshot.tar");
  await execFileAsync("tar", ["-cf", tarPath, "-C", treeRoot, "."]);
  return tarPath;
};

vi.mock("../src/genaiClient.js", () => ({
  createGenAIClient: () => genai
}));

describe("agent commands", () => {
  beforeEach(() => {
    for (const group of [genai.agents, genai.interactions, genai.files]) {
      for (const fn of Object.values(group)) {
        fn.mockReset();
      }
    }
  });

  it("supports create dry runs without calling the API", async () => {
    const result = await runAgentCreate("researcher", {
      dryRun: true,
      description: "web research helper",
      tool: ["google_search"]
    });

    expect(result.ok).toBe(true);
    expect(result.capability).toBe("agent");
    expect(result.model).toBe("antigravity-preview-05-2026");
    expect(result.details).toMatchObject({
      apiSurface: "managed-agent",
      action: "create",
      agent: {
        id: "researcher",
        base_agent: "antigravity-preview-05-2026",
        description: "web research helper",
        tools: [{ type: "google_search" }]
      }
    });
    expect(genai.agents.create).not.toHaveBeenCalled();
  });

  it("rejects unknown tools", async () => {
    await expect(runAgentCreate("bad", { tool: ["shell"] })).rejects.toThrow(/Unknown tool "shell"/);
    expect(genai.agents.create).not.toHaveBeenCalled();
  });

  it("creates an agent with a system instruction file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gai-agent-"));
    const systemFile = join(dir, "system.md");
    try {
      await writeFile(systemFile, "You are a careful researcher.\n");
      genai.agents.create.mockResolvedValueOnce({
        id: "researcher",
        base_agent: "antigravity-preview-05-2026",
        create_time: "2026-07-06T00:00:00Z"
      });

      const result = await runAgentCreate("researcher", { systemFile });

      expect(genai.agents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "researcher",
          base_agent: "antigravity-preview-05-2026",
          system_instruction: "You are a careful researcher."
        })
      );
      expect(result.message).toBe("Created agent researcher.");
      expect(result.details).toMatchObject({
        agent: { id: "researcher", create_time: "2026-07-06T00:00:00Z" }
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lists, gets, and deletes agents", async () => {
    genai.agents.list.mockResolvedValueOnce({ agents: [{ id: "a" }, { id: "b" }] });
    genai.agents.get.mockResolvedValueOnce({ id: "a", base_agent: "antigravity-preview-05-2026" });
    genai.agents.delete.mockResolvedValueOnce({});

    const list = await runAgentList();
    expect(list.message).toBe("2 agent(s).");
    expect(list.details).toMatchObject({ agents: [{ id: "a" }, { id: "b" }] });

    const get = await runAgentGet("a");
    expect(get.details).toMatchObject({ agent: { id: "a" } });
    expect(genai.agents.get).toHaveBeenCalledWith("a");

    const del = await runAgentDelete("a");
    expect(del.message).toBe("Deleted agent a.");
    expect(genai.agents.delete).toHaveBeenCalledWith("a");
  });

  it("supports run dry runs without calling the API", async () => {
    const result = await runAgentRun("researcher", "find the news", { dryRun: true });

    expect(result.details).toMatchObject({
      apiSurface: "managed-agent",
      action: "run",
      wait: true,
      request: {
        agent: "researcher",
        input: "find the news",
        environment: "remote",
        background: true
      }
    });
    expect(genai.interactions.create).not.toHaveBeenCalled();
  });

  it("runs an interaction and polls until completion", async () => {
    genai.interactions.create.mockResolvedValueOnce({ id: "int_1", status: "in_progress" });
    genai.interactions.get
      .mockResolvedValueOnce({ id: "int_1", status: "in_progress" })
      .mockResolvedValueOnce({ id: "int_1", status: "completed", output_text: "done!" });

    const dir = await mkdtemp(join(tmpdir(), "gai-agent-run-"));
    const out = join(dir, "result.txt");
    try {
      const result = await runAgentRun("researcher", "do the thing", {
        out,
        pollInterval: "0.001"
      });

      expect(genai.interactions.create).toHaveBeenCalledWith(
        expect.objectContaining({ agent: "researcher", background: true })
      );
      expect(genai.interactions.get).toHaveBeenCalledWith("int_1");
      expect(result.message).toBe("done!");
      expect(result.details).toMatchObject({ interactionId: "int_1", status: "completed" });
      expect(await readFile(out, "utf8")).toBe("done!\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns immediately with --background", async () => {
    genai.interactions.create.mockResolvedValueOnce({ id: "int_2", status: "queued" });

    const result = await runAgentRun("researcher", "long job", { background: true });

    expect(result.message).toContain("int_2");
    expect(result.message).toContain("gai agent status");
    expect(genai.interactions.get).not.toHaveBeenCalled();
  });

  it("surfaces failed interactions as errors", async () => {
    genai.interactions.create.mockResolvedValueOnce({
      id: "int_3",
      status: "failed",
      error: { message: "boom" }
    });

    await expect(runAgentRun("researcher", "explode", {})).rejects.toThrow(/int_3 failed/);
  });

  it("treats incomplete and budget_exceeded as terminal while waiting", async () => {
    genai.interactions.create.mockResolvedValueOnce({ id: "int_incomplete", status: "incomplete" });
    const incomplete = await runAgentRun("researcher", "too broad", {});
    expect(incomplete.details).toMatchObject({ interactionId: "int_incomplete", status: "incomplete" });
    expect(genai.interactions.get).not.toHaveBeenCalled();

    genai.interactions.get.mockResolvedValueOnce({
      id: "int_budget",
      status: "budget_exceeded",
      output_text: "partial"
    });
    const budget = await runAgentStatus("int_budget", { wait: true });
    expect(budget.details).toMatchObject({ interactionId: "int_budget", status: "budget_exceeded" });
  });

  it("reports status and cancels interactions", async () => {
    genai.interactions.get.mockResolvedValueOnce({ id: "int_4", status: "in_progress" });
    const status = await runAgentStatus("int_4", {});
    expect(status.message).toBe("Interaction int_4 status: in_progress.");

    genai.interactions.cancel.mockResolvedValueOnce({ id: "int_4", status: "cancelled" });
    const cancel = await runAgentCancel("int_4");
    expect(cancel.message).toBe("Interaction int_4 cancel requested.");
    expect(genai.interactions.cancel).toHaveBeenCalledWith("int_4");
  });

  it("waits for completion with status --wait", async () => {
    genai.interactions.get
      .mockResolvedValueOnce({ id: "int_5", status: "in_progress" })
      .mockResolvedValueOnce({ id: "int_5", status: "completed", output_text: "final answer" });

    const result = await runAgentStatus("int_5", { wait: true, pollInterval: "0.001" });
    expect(result.message).toBe("final answer");
    expect(result.details).toMatchObject({ status: "completed" });
  });

  it("deletes an interaction", async () => {
    genai.interactions.delete.mockResolvedValueOnce({});
    const result = await runAgentDeleteInteraction("int_6");
    expect(result.message).toBe("Deleted interaction int_6.");
    expect(genai.interactions.delete).toHaveBeenCalledWith("int_6");
  });

  it("lists environment snapshot files, resolving the environment from an interaction", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gai-agent-snap-"));
    try {
      const tarPath = await makeSnapshotTar(dir);
      genai.interactions.get.mockResolvedValueOnce({ id: "int_7", environment_id: "env_1" });
      genai.files.download.mockImplementationOnce(async ({ downloadPath }: { downloadPath: string }) => {
        await copyFile(tarPath, downloadPath);
      });

      const result = await runAgentLs(undefined, { interaction: "int_7" });

      expect(genai.files.download).toHaveBeenCalledWith(
        expect.objectContaining({ file: "environment-env_1" })
      );
      expect(result.details).toMatchObject({ environmentId: "env_1" });
      const files = (result.details as { files: string[] }).files;
      expect(files).toContain("notes.txt");
      expect(files).toContain("output/report.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("pulls and extracts an environment snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gai-agent-pull-"));
    try {
      const tarPath = await makeSnapshotTar(dir);
      genai.files.download.mockImplementationOnce(async ({ downloadPath }: { downloadPath: string }) => {
        await copyFile(tarPath, downloadPath);
      });

      const out = join(dir, "snap-out.tar.gz");
      const extractDir = join(dir, "extracted");
      const result = await runAgentPull("env_2", { out, extract: extractDir });

      expect(result.outputs?.[0]).toMatchObject({ path: out });
      expect(result.details).toMatchObject({ environmentId: "env_2", extractedTo: extractDir });
      expect(await readFile(join(extractDir, "output", "report.md"), "utf8")).toBe("# report");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects ambiguous or missing environment targets", async () => {
    await expect(runAgentLs("env_3", { interaction: "int_8" })).rejects.toThrow(/not both/);
    await expect(runAgentLs(undefined, {})).rejects.toThrow(/environment id argument or --interaction/);
    expect(genai.files.download).not.toHaveBeenCalled();
  });
});
