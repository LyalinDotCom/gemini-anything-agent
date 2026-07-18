import { afterAll, describe, expect, test } from "vitest";
import { deleteAgent, ensureAgent } from "../src/gemini/agents";
import { ai } from "../src/gemini/client";
import { downloadSnapshot } from "../src/gemini/envFiles";
import { buildInteractionParams } from "../src/gemini/interactionParams";
import { blocksFromInteraction } from "../src/gemini/streamAdapter";
import { hasKey, skipNote, uniqueAgentId } from "./helpers";

const agentId = uniqueAgentId().replace("companion", "browser");
let interactionId = "";

afterAll(async () => {
  if (!hasKey()) return;
  if (interactionId) await ai().interactions.delete(interactionId).catch(() => undefined);
  await deleteAgent(agentId).catch(() => undefined);
});

describe("Browser profile live", () => {
  test("background Browser run navigates, asserts, screenshots, and syncs artifacts", async () => {
    if (!hasKey()) return skipNote("browser profile");
    const agent = await ensureAgent(agentId, null, true);
    expect(agent.degraded).toBe(false);

    const created = await ai().interactions.create(buildInteractionParams({
      agent: agentId,
      input: [
        "Use `bash /.agents/bin/browser` and the mounted browser-testing skill to test https://demo.playwright.dev/todomvc/.",
        "Add exactly two todos named Buy groceries and Water flowers, mark only Buy groceries complete, and verify exactly 2 todos with exactly 1 completed.",
        "Save a full-page PNG to /workspace/output/browser/web-profile.png and a JSON report with todoCount and completedCount to /workspace/output/browser/web-profile.json.",
        "Verify the files are nonempty, close the browser session, and report the paths.",
      ].join(" "),
      systemInstruction: "Act as a browser testing specialist. Execute and verify the real browser flow; save durable evidence under /workspace/output/browser.",
      store: true,
      background: true,
      stream: false,
    }) as never) as Record<string, unknown>;
    interactionId = String(created.id ?? "");
    expect(interactionId).not.toBe("");

    const deadline = Date.now() + 8 * 60_000;
    let outcome = blocksFromInteraction(created);
    while (["queued", "pending", "running", "in_progress"].includes(outcome.status.toLowerCase())) {
      if (Date.now() > deadline) throw new Error("Browser profile live test timed out");
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      outcome = blocksFromInteraction(await ai().interactions.get(interactionId) as Record<string, unknown>);
    }
    expect(outcome.status).toBe("completed");
    expect(outcome.environmentId).not.toBe("");

    const entries = await downloadSnapshot(outcome.environmentId);
    const screenshot = entries.find((entry) => entry.name.endsWith("workspace/output/browser/web-profile.png"));
    const reportEntry = entries.find((entry) => entry.name.endsWith("workspace/output/browser/web-profile.json"));
    expect(screenshot?.data.slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(reportEntry).toBeTruthy();
    const report = JSON.parse(new TextDecoder().decode(reportEntry!.data)) as Record<string, unknown>;
    expect(report.todoCount).toBe(2);
    expect(report.completedCount).toBe(1);
    expect(entries.some((entry) => /(?:^|\/)(?:\.npm-cache|ms-playwright)(?:\/|$)/.test(entry.name))).toBe(false);
  }, 600_000);
});
