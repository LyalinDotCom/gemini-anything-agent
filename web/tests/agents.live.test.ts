// Live managed-agent lifecycle against the real API (unique ids, cleanup in afterAll).
import { afterAll, describe, expect, test } from "vitest";
import { deleteAgent, ensureAgent } from "../src/gemini/agents";
import { ai } from "../src/gemini/client";
import { toFriendly } from "../src/gemini/errors";
import { hasKey, skipNote, uniqueAgentId } from "./helpers";

const agentId = uniqueAgentId();

afterAll(async () => {
  if (!hasKey()) return;
  try {
    await deleteAgent(agentId);
  } catch {
    // best-effort cleanup
  }
});

describe("managed agent lifecycle", () => {
  test("ensure creates, re-ensure reuses, delete + 404 mapping works", async () => {
    if (!hasKey()) return skipNote("agent lifecycle");

    const first = await ensureAgent(agentId, null);
    expect(first.degraded).toBe(false);
    expect(first.agentId).toBe(agentId);

    // Re-ensure with fresh info: server GET path (force) must still land healthy.
    const second = await ensureAgent(agentId, first, true);
    expect(second.degraded).toBe(false);
    expect(second.verifiedAt).toBeGreaterThanOrEqual(first.verifiedAt);

    // Duplicate raw create → conflict kind.
    try {
      await ai().agents.create({ id: agentId, base_agent: first.baseAgent } as never);
      throw new Error("expected conflict");
    } catch (e) {
      expect(toFriendly(e).kind).toBe("conflict");
    }

    await deleteAgent(agentId);
    try {
      await ai().agents.get(agentId);
      throw new Error("expected not-found");
    } catch (e) {
      expect(toFriendly(e).kind).toBe("not-found");
    }

    // Ensure after delete recreates.
    const third = await ensureAgent(agentId, second, true);
    expect(third.degraded).toBe(false);
  }, 180_000);
});
