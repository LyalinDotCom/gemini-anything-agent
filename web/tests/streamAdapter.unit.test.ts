import { describe, expect, test } from "vitest";
import { blocksFromInteraction, consumeInteractionStream } from "../src/gemini/streamAdapter";

async function* events(list: Array<Record<string, unknown>>) {
  for (const e of list) yield e;
}

// Event shapes below mirror recordings taken from live interaction streams.
describe("consumeInteractionStream", () => {
  test("text streaming accumulates deltas and harvests ids from lifecycle events", async () => {
    const outcome = await consumeInteractionStream(
      events([
        { event_type: "interaction.created", interaction: { id: "v1_X", status: "in_progress" } },
        { event_type: "step.start", index: 0, step: { type: "thought" } },
        { event_type: "step.delta", index: 0, delta: { type: "thought_summary", text: "hmm" } },
        { event_type: "step.stop", index: 0, step: { type: "thought" } },
        { event_type: "step.start", index: 1, step: { type: "model_output" } },
        { event_type: "step.delta", index: 1, delta: { type: "text", text: "Hel" } },
        { event_type: "step.delta", index: 1, delta: { type: "text", text: "lo" } },
        { event_type: "step.stop", index: 1, step: { type: "model_output" } },
        {
          event_type: "interaction.completed",
          interaction: {
            id: "v1_X",
            status: "completed",
            environment_id: "env_9",
            usage: { total_input_tokens: 5, total_output_tokens: 2 },
          },
        },
      ]),
    );
    expect(outcome.interactionId).toBe("v1_X");
    expect(outcome.environmentId).toBe("env_9");
    expect(outcome.status).toBe("completed");
    expect(outcome.usage).toEqual({
      inputTokens: 5,
      outputTokens: 2,
      thoughtTokens: undefined,
      cachedTokens: undefined,
    });
    const thought = outcome.blocks.find((b) => b.type === "thought");
    expect(thought?.text).toBe("hmm");
    const text = outcome.blocks.find((b) => b.type === "model_output");
    expect(text?.text).toBe("Hello");
    expect(text?.done).toBe(true);
  });

  test("function_call args accumulate via arguments_delta strings and parse at stop", async () => {
    const outcome = await consumeInteractionStream(
      events([
        { event_type: "interaction.created", interaction: { id: "v1_F", status: "in_progress" } },
        { event_type: "step.start", index: 0, step: { type: "function_call", id: "call9", name: "generate_image" } },
        { event_type: "step.delta", index: 0, delta: { type: "arguments_delta", arguments: '{"prompt":"a ' } },
        { event_type: "step.delta", index: 0, delta: { type: "arguments_delta", arguments: 'red circle"}' } },
        { event_type: "step.stop", index: 0, step: { type: "function_call", id: "call9", arguments: {} } },
        {
          event_type: "interaction.status_update",
          interaction_id: "v1_F",
          status: "requires_action",
          event_id: "ev_77",
        },
      ]),
    );
    const call = outcome.blocks[0];
    expect(call.type).toBe("function_call");
    expect(call.id).toBe("call9");
    expect(call.arguments).toEqual({ prompt: "a red circle" });
    expect(outcome.status).toBe("requires_action");
    expect(outcome.lastEventId).toBe("ev_77");
  });

  test("code execution call/result pair and merge (code fragments + result append)", async () => {
    const outcome = await consumeInteractionStream(
      events([
        { event_type: "step.start", index: 0, step: { type: "code_execution_call", id: "c1" } },
        { event_type: "step.delta", index: 0, delta: { type: "code_execution_call", arguments: { code: "print(1" } } },
        { event_type: "step.delta", index: 0, delta: { type: "code_execution_call", arguments: { code: ")" } } },
        { event_type: "step.stop", index: 0, step: { type: "code_execution_call", id: "c1" } },
        { event_type: "step.start", index: 1, step: { type: "code_execution_result", call_id: "c1" } },
        { event_type: "step.delta", index: 1, delta: { type: "code_execution_result", result: "1\n", is_error: false } },
        { event_type: "step.stop", index: 1, step: { type: "code_execution_result", call_id: "c1" } },
      ]),
    );
    expect(outcome.blocks[0].code).toBe("print(1)");
    expect(outcome.blocks[1].callId).toBe("c1");
    expect(outcome.blocks[1].result).toBe("1\n");
    expect(outcome.blocks[1].isError).toBe(false);
  });

  test("interaction.completed reconciles thought text that never streamed", async () => {
    const outcome = await consumeInteractionStream(
      events([
        { event_type: "step.start", index: 0, step: { type: "thought" } },
        { event_type: "step.stop", index: 0, step: { type: "thought" } },
        { event_type: "step.start", index: 1, step: { type: "model_output" } },
        { event_type: "step.delta", index: 1, delta: { type: "text", text: "42" } },
        {
          event_type: "interaction.completed",
          interaction: {
            id: "v1_R",
            status: "completed",
            steps: [{ type: "thought", summary: [{ text: "deep thoughts" }] }, { type: "model_output" }],
          },
        },
      ]),
    );
    expect(outcome.blocks[0].text).toBe("deep thoughts");
    expect(outcome.blocks[1].text).toBe("42");
  });

  test("lazy block creation when a delta arrives before its step.start", async () => {
    const outcome = await consumeInteractionStream(
      events([{ event_type: "step.delta", index: 3, delta: { type: "text", text: "orphan" } }]),
    );
    expect(outcome.blocks[0].text).toBe("orphan");
    expect(outcome.blocks[0].type).toBe("text");
  });

  test("onUpdate fires with monotonically growing content", async () => {
    const snapshots: string[] = [];
    await consumeInteractionStream(
      events([
        { event_type: "step.start", index: 0, step: { type: "model_output" } },
        { event_type: "step.delta", index: 0, delta: { type: "text", text: "a" } },
        { event_type: "step.delta", index: 0, delta: { type: "text", text: "b" } },
      ]),
      (blocks) => snapshots.push(blocks[0]?.text ?? ""),
    );
    expect(snapshots).toEqual(["", "a", "ab"]);
  });
});

describe("blocksFromInteraction", () => {
  test("expands model_output content arrays and keeps tool steps (non-streaming shape)", () => {
    const outcome = blocksFromInteraction({
      id: "v1_N",
      status: "completed",
      environment_id: "env_1",
      steps: [
        { type: "thought", summary: [{ text: "t" }] },
        { type: "code_execution_call", id: "c1", arguments: { code: "print(9)" } },
        { type: "code_execution_result", call_id: "c1", result: "9\n" },
        { type: "model_output", content: [{ type: "text", text: "Nine." }, { type: "image", data: "QUJD", mime_type: "image/png" }] },
      ],
    });
    expect(outcome.interactionId).toBe("v1_N");
    expect(outcome.environmentId).toBe("env_1");
    const types = outcome.blocks.map((b) => b.type);
    expect(types).toEqual(["thought", "code_execution_call", "code_execution_result", "text", "image"]);
    expect(outcome.blocks[1].code).toBe("print(9)");
    expect(outcome.blocks[3].text).toBe("Nine.");
    expect(outcome.blocks[4].data).toBe("QUJD");
  });
});
