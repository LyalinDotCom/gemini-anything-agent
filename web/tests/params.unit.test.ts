import { describe, expect, test } from "vitest";
import { buildInteractionParams, functionResultPart, tools } from "../src/gemini/interactionParams";
import { MODELS } from "../src/models";

describe("buildInteractionParams", () => {
  test("agent turn 1 auto-enables remote environment", () => {
    const body = buildInteractionParams({
      agent: MODELS.chatAgentBase,
      input: "hi",
      toolset: [tools.codeExecution],
      stream: true,
    });
    expect(body).toEqual({
      input: "hi",
      stream: true,
      agent: MODELS.chatAgentBase,
      environment: "remote",
      tools: [{ type: "code_execution" }],
    });
  });

  test("continuation passes environment id and previous interaction id", () => {
    const body = buildInteractionParams({
      agent: MODELS.chatAgentBase,
      input: "next",
      previousInteractionId: "v1_abc",
      environmentId: "env_123",
      stream: true,
    });
    expect(body.environment).toBe("env_123");
    expect(body.previous_interaction_id).toBe("v1_abc");
  });

  test("model turns get no implicit environment", () => {
    const body = buildInteractionParams({ model: MODELS.text, input: "hi", stream: false });
    expect(body).toEqual({ input: "hi", stream: false, model: MODELS.text });
  });

  test("deep research injects background + agent_config and skips auto-remote", () => {
    const body = buildInteractionParams({
      agent: MODELS.deepResearch,
      input: "research X",
      deepResearch: true,
      stream: false,
    });
    expect(body.background).toBe(true);
    expect(body.store).toBe(true); // background runs must be stored to reattach/poll
    expect(body.agent_config).toEqual({ type: "deep-research", thinking_summaries: "auto" });
    expect(body.environment).toBeUndefined();
  });

  test("advanced chat options map to interaction fields", () => {
    const body = buildInteractionParams({
      agent: MODELS.chatAgentBase,
      input: "ship it",
      toolset: [],
      store: true,
      background: true,
      serviceTier: "priority",
      thinkingSummaries: "auto",
      stream: false,
    });
    expect(body).toMatchObject({
      store: true,
      background: true,
      service_tier: "priority",
      tools: [],
      agent_config: { type: "dynamic", thinking_summaries: "auto" },
    });
  });

  test("deep research continuations carry the previous environment id when present", () => {
    const body = buildInteractionParams({
      agent: MODELS.deepResearch,
      input: "continue research",
      previousInteractionId: "v1_research",
      environmentId: "env_research",
      deepResearch: true,
      stream: false,
    });
    expect(body.environment).toBe("env_research");
    expect(body.previous_interaction_id).toBe("v1_research");
    expect(body.background).toBe(true);
    expect(body.store).toBe(true);
  });

  test("seed sources build an inline remote environment (degraded mode)", () => {
    const body = buildInteractionParams({
      agent: MODELS.chatAgentBase,
      input: "hi",
      seedSources: [{ type: "inline", target: "/.agents/AGENTS.md", content: "# P" }],
      stream: true,
    });
    expect(body.environment).toEqual({
      type: "remote",
      sources: [{ type: "inline", target: "/.agents/AGENTS.md", content: "# P" }],
    });
  });

  test("function tool declaration and result part shapes match the wire format", () => {
    const decl = tools.fn("generate_image", "make image", {
      type: "object",
      properties: { prompt: { type: "string" } },
      required: ["prompt"],
    });
    expect(decl.type).toBe("function");
    expect(decl.name).toBe("generate_image");

    const part = functionResultPart("call_1", "generate_image", "ok");
    expect(part).toEqual({ type: "function_result", call_id: "call_1", name: "generate_image", result: "ok" });
  });
});
