// Live tests (real API, real key; skip-not-fail without GEMINI_API_KEY — gaicli style).
import { describe, expect, test } from "vitest";
import { ai } from "../src/gemini/client";
import { buildInteractionParams, tools } from "../src/gemini/interactionParams";
import { asEventStream, consumeInteractionStream } from "../src/gemini/streamAdapter";
import { MODELS } from "../src/models";
import { hasKey, skipNote } from "./helpers";

const textOf = (blocks: Array<{ type: string; text?: string }>): string =>
  blocks
    .filter((b) => b.type === "model_output" || b.type === "text")
    .map((b) => b.text ?? "")
    .join("");

describe("interactions live", () => {
  test("model pong streams and completes", async () => {
    if (!hasKey()) return skipNote("pong");
    const stream = await ai().interactions.create(
      buildInteractionParams({ model: MODELS.text, input: "Reply with exactly: pong", stream: true }) as never,
    );
    const outcome = await consumeInteractionStream(asEventStream(stream));
    expect(outcome.interactionId).not.toBe("");
    expect(outcome.status).toBe("completed");
    expect(textOf(outcome.blocks).toLowerCase()).toContain("pong");
  });

  test("agent runs code and the chain recalls context with env reuse", async () => {
    if (!hasKey()) return skipNote("agent chain");
    const s1 = await ai().interactions.create(
      buildInteractionParams({
        agent: MODELS.chatAgentBase,
        input: "Use python to compute 12345*6789. Also remember: my favorite fruit is banana.",
        toolset: [tools.codeExecution],
        stream: true,
      }) as never,
    );
    const o1 = await consumeInteractionStream(asEventStream(s1));
    expect(o1.status).toBe("completed");
    expect(o1.environmentId).not.toBe("");
    expect(o1.blocks.some((b) => b.type === "code_execution_call")).toBe(true);
    expect(o1.blocks.some((b) => b.type === "code_execution_result")).toBe(true);
    expect(textOf(o1.blocks)).toContain("83");

    const s2 = await ai().interactions.create(
      buildInteractionParams({
        agent: MODELS.chatAgentBase,
        input: "What is my favorite fruit? One word.",
        previousInteractionId: o1.interactionId,
        environmentId: o1.environmentId,
        stream: true,
      }) as never,
    );
    const o2 = await consumeInteractionStream(asEventStream(s2));
    expect(textOf(o2.blocks).toLowerCase()).toContain("banana");
  }, 180_000);
});
