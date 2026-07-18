import { describe, expect, it } from "vitest";
import type { Interaction, InteractionStreamEvent } from "../src/sdk";
import { buildTimeline, firstLine } from "../src/renderer/lib/timeline";
import {
  interactionIsTerminal,
  mergeStreamEvents,
  sessionCanReconnect
} from "../src/renderer/lib/sessionState";
import type { Session } from "../src/renderer/lib/builderState";

describe("buildTimeline — terminal steps[]", () => {
  it("folds a call+result pair into one command and uses output_text for the answer", () => {
    const interaction: Interaction = {
      id: "int_1",
      status: "completed",
      output_text: "Final answer.",
      steps: [
        { type: "code_execution_call", command: "ls -la" },
        { type: "code_execution_result", output: "file1\nfile2" },
        { type: "thought", summary: "thinking about it" },
        { type: "model_output", content: [{ text: "streamed partial" }] }
      ]
    };

    const items = buildTimeline(interaction, undefined);

    expect(items).toHaveLength(3);
    expect(items[0].kind).toBe("command");
    expect(items[0].title).toBe("Run command");
    expect(items[0].body).toContain("ls -la");
    expect(items[0].body).toContain("file1"); // result merged into the command
    expect(items[1].kind).toBe("thinking");

    // exactly one assistant message, body taken from the authoritative output_text
    const messages = items.filter((item) => item.kind === "message");
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe("Final answer.");
    expect(messages[0].markdown).toBe(true);
  });

  it("relabels a write_file function call and merges its result", () => {
    const interaction: Interaction = {
      id: "int_2",
      status: "completed",
      steps: [
        { type: "function_call", name: "write_file", args: { path: "/foo.py", contents: "print(1)" } },
        { type: "function_result", output: "ok" }
      ]
    };

    const items = buildTimeline(interaction, undefined);

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("write_file");
    expect(items[0].title).toBe("Write file");
    expect(items[0].summary).toBe("/foo.py");
    expect(items[0].body).toContain("ok"); // result merged in
  });

  it("appends an assistant message when steps have no model_output but output_text exists", () => {
    const interaction: Interaction = {
      id: "int_3",
      status: "completed",
      output_text: "Here is the result.",
      steps: [{ type: "code_execution_call", command: "echo hi" }]
    };

    const items = buildTimeline(interaction, undefined);
    expect(items.at(-1)?.kind).toBe("message");
    expect(items.at(-1)?.body).toBe("Here is the result.");
  });

  it("does not duplicate model_output that only echoes output_text", () => {
    const interaction: Interaction = {
      id: "int_3a",
      status: "completed",
      output_text: "Done.",
      steps: [{ type: "model_output", content: [{ text: "Done." }] }]
    };

    const items = buildTimeline(interaction, undefined);

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("message");
    expect(items[0].body).toBe("Done.");
  });

  it("drops content-less finished thought stubs instead of showing raw JSON", () => {
    const interaction: Interaction = {
      id: "int_3b",
      status: "completed",
      steps: [
        { type: "thought" },
        { type: "model_output", content: [{ text: "Done." }] }
      ]
    };

    const items = buildTimeline(interaction, undefined);

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("message");
    expect(items[0].body).toBe("Done.");
  });

  it("renders thought summaries but hides user input echoes", () => {
    const interaction: Interaction = {
      id: "int_thought_summary",
      status: "completed",
      steps: [
        { type: "user_input", content: [{ type: "text", text: "repeat prompt" }] },
        { type: "thought_summary", content: { type: "text", text: "I should inspect the repo." } },
        { type: "model_output", content: [{ type: "text", text: "Done." }] }
      ]
    };

    const items = buildTimeline(interaction, undefined);

    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("thinking");
    expect(items[0].body).toBe("I should inspect the repo.");
    expect(items[1].kind).toBe("message");
  });
});

describe("buildTimeline — live event stream", () => {
  it("accumulates deltas per step and marks unstopped steps as running", () => {
    const events: InteractionStreamEvent[] = [
      { event_type: "step.start", index: 0, step: { type: "code_execution_call" } },
      { event_type: "step.delta", index: 0, delta: { type: "code_execution_call" } },
      { event_type: "step.delta", index: 0, delta: { command: "echo hi" } },
      { event_type: "step.stop", index: 0 },
      { event_type: "step.start", index: 1, step: { type: "model_output" } },
      { event_type: "step.delta", index: 1, delta: { type: "text", text: "Hello " } },
      { event_type: "step.delta", index: 1, delta: { type: "text", text: "world" } }
    ];

    const items = buildTimeline(undefined, events);

    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("command");
    expect(items[0].body).toBe("echo hi");
    expect(items[0].status).toBe("done");
    expect(items[1].kind).toBe("message");
    expect(items[1].body).toBe("Hello world");
    expect(items[1].status).toBe("running");
  });

  it("uses the live stream when present and ignores empty terminal seed steps", () => {
    // A seed whose steps were only stubbed by step.start (no content) should lose
    // to the richer event stream while a run is still streaming.
    const interaction: Interaction = {
      id: "int_4",
      steps: [{ type: "code_execution_call" }] // no command/output text
    };
    const events: InteractionStreamEvent[] = [
      { event_type: "step.start", index: 0, step: { type: "code_execution_call" } },
      { event_type: "step.delta", index: 0, delta: { command: "python run.py" } }
    ];

    const items = buildTimeline(interaction, events);
    expect(items[0].body).toBe("python run.py");
  });

  it("preserves streamed actions after completion and groups consecutive same-kind rows", () => {
    const interaction: Interaction = {
      id: "int_5",
      status: "completed",
      output_text: "Final answer.",
      steps: [{ type: "model_output", content: [{ text: "terminal answer" }] }]
    };
    const events: InteractionStreamEvent[] = [
      { event_type: "step.start", index: 0, step: { type: "function_call" } },
      { event_type: "step.delta", index: 0, delta: { arguments: "{\"path\":\"a.txt\"}" } },
      { event_type: "step.stop", index: 0 },
      { event_type: "step.start", index: 1, step: { type: "function_call" } },
      { event_type: "step.delta", index: 1, delta: { arguments: "{\"path\":\"b.txt\"}" } },
      { event_type: "step.stop", index: 1 },
      { event_type: "step.start", index: 2, step: { type: "model_output" } },
      { event_type: "step.delta", index: 2, delta: { text: "partial" } },
      { event_type: "step.stop", index: 2 }
    ];

    const items = buildTimeline(interaction, events);

    expect(items).toHaveLength(3);
    expect(items[0].kind).toBe("function");
    expect(items[0].count).toBe(2);
    expect(items[0].details?.map((detail) => detail.body)).toEqual([
      "{\"path\":\"a.txt\"}",
      "{\"path\":\"b.txt\"}"
    ]);
    expect(items[1].kind).toBe("thinking");
    expect(items[1].body).toBe("partial");
    expect(items[2].kind).toBe("message");
    expect(items[2].body).toBe("Final answer.");
  });

  it("groups commands that become adjacent after empty thinking stubs are hidden", () => {
    const events: InteractionStreamEvent[] = [
      { event_type: "step.start", index: 0, step: { type: "code_execution_call" } },
      { event_type: "step.delta", index: 0, delta: { command: "env" } },
      { event_type: "step.stop", index: 0 },
      { event_type: "step.start", index: 1, step: { type: "thought" } },
      { event_type: "step.stop", index: 1 },
      { event_type: "step.start", index: 2, step: { type: "code_execution_call" } },
      { event_type: "step.delta", index: 2, delta: { command: "pwd" } },
      { event_type: "step.stop", index: 2 },
      { event_type: "step.start", index: 3, step: { type: "thought" } },
      { event_type: "step.stop", index: 3 },
      { event_type: "step.start", index: 4, step: { type: "code_execution_call" } },
      { event_type: "step.delta", index: 4, delta: { command: "ls" } },
      { event_type: "step.stop", index: 4 }
    ];

    const items = buildTimeline({ id: "int_commands", status: "completed" }, events);

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("command");
    expect(items[0].title).toBe("Run command");
    expect(items[0].count).toBe(3);
    expect(items[0].details?.map((detail) => detail.body)).toEqual(["env", "pwd", "ls"]);
  });

  it("extracts command text from nested code execution arguments", () => {
    const interaction: Interaction = {
      id: "int_nested_commands",
      status: "completed",
      steps: [
        { type: "code_execution_call", arguments: { code: "echo $PATH" } },
        { type: "code_execution_call", arguments: "{\"code\":\"which gemini && gemini --version\"}" }
      ]
    };

    const items = buildTimeline(interaction, undefined);

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("command");
    expect(items[0].count).toBe(2);
    expect(items[0].details?.map((detail) => detail.body)).toEqual([
      "echo $PATH",
      "which gemini && gemini --version"
    ]);
  });

  it("hydrates missing streamed action text from terminal steps without replacing stream order", () => {
    const interaction: Interaction = {
      id: "int_6",
      status: "completed",
      output_text: "Done.",
      steps: [
        { type: "code_execution_call", command: "npm test" },
        { type: "model_output", content: [{ text: "Done." }] }
      ]
    };
    const events: InteractionStreamEvent[] = [
      { event_type: "step.start", index: 0, step: { type: "code_execution_call" } },
      { event_type: "step.stop", index: 0 },
      { event_type: "step.start", index: 1, step: { type: "model_output" } },
      { event_type: "step.delta", index: 1, delta: { text: "partial" } }
    ];

    const items = buildTimeline(interaction, events);

    expect(items[0].kind).toBe("command");
    expect(items[0].body).toBe("npm test");
    expect(items[0].status).toBe("done");
    expect(items[1].kind).toBe("thinking");
    expect(items[1].body).toBe("partial");
    expect(items[2].kind).toBe("message");
    expect(items[2].body).toBe("Done.");
  });

  it("keeps a content-less thought only while it is still running", () => {
    const running = buildTimeline(undefined, [
      { event_type: "step.start", index: 0, step: { type: "thought" } }
    ]);

    expect(running).toHaveLength(1);
    expect(running[0].kind).toBe("thinking");
    expect(running[0].body).toBeUndefined();
    expect(running[0].status).toBe("running");

    const stopped = buildTimeline(undefined, [
      { event_type: "step.start", index: 0, step: { type: "thought" } },
      { event_type: "step.stop", index: 0 }
    ]);

    expect(stopped).toHaveLength(0);
  });

  it("parses GA thought summary and search/url event names", () => {
    const events: InteractionStreamEvent[] = [
      { event_type: "step.start", index: 0, step: { type: "thought_summary" } },
      {
        event_type: "step.delta",
        index: 0,
        delta: { type: "thought_summary", content: { type: "text", text: "Need current docs." } }
      },
      { event_type: "step.stop", index: 0 },
      { event_type: "step.start", index: 1, step: { type: "google_search_call" } },
      { event_type: "step.delta", index: 1, delta: { arguments: "{\"query\":\"Interactions API GA\"}" } },
      { event_type: "step.stop", index: 1 },
      { event_type: "step.start", index: 2, step: { type: "url_context_call" } },
      { event_type: "step.delta", index: 2, delta: { arguments: "{\"url\":\"https://ai.google.dev\"}" } },
      { event_type: "step.stop", index: 2 }
    ];

    const items = buildTimeline(undefined, events);

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ kind: "thinking", body: "Need current docs." });
    expect(items[1]).toMatchObject({ kind: "search", title: "Google Search" });
    expect(items[2]).toMatchObject({ kind: "url", title: "Fetch URL" });
  });
});

describe("firstLine", () => {
  it("keeps delta text on its own step when the step.start was evicted by the event cap", () => {
    // Simulates a long run where early events (including index 2's step.start)
    // fell off the front of the 300-event window.
    const events: InteractionStreamEvent[] = [
      { event_type: "step.delta", index: 2, delta: { command: "npm run build" } },
      { event_type: "step.stop", index: 2 },
      { event_type: "step.start", index: 3, step: { type: "model_output" } },
      { event_type: "step.delta", index: 3, delta: { text: "All done" } },
      { event_type: "step.stop", index: 3 }
    ];
    const interaction: Interaction = {
      id: "int_evicted",
      status: "completed",
      steps: [
        { type: "thought", summary: "planning" },
        { type: "thought", summary: "more planning" },
        { type: "code_execution_call", command: "npm run build" },
        { type: "model_output", content: [{ text: "All done" }] }
      ]
    };

    const items = buildTimeline(interaction, events);

    // The orphaned delta must render as a command step (type hydrated from
    // steps[2] by index), not vanish or glue onto another row.
    const command = items.find((item) => item.kind === "command");
    expect(command?.body).toBe("npm run build");
    expect(command?.status).toBe("done");
  });

  it("hydrates streamed steps from terminal steps by index, not by array position", () => {
    // Early events evicted: the stream only saw steps 2 and 3. Positional
    // alignment would hydrate them from steps[0] and steps[1].
    const events: InteractionStreamEvent[] = [
      { event_type: "step.start", index: 2, step: { type: "code_execution_call" } },
      { event_type: "step.stop", index: 2 },
      { event_type: "step.start", index: 3, step: { type: "function_call" } },
      { event_type: "step.stop", index: 3 }
    ];
    const interaction: Interaction = {
      id: "int_offset",
      status: "completed",
      steps: [
        { type: "thought", summary: "wrong text for step 0" },
        { type: "thought", summary: "wrong text for step 1" },
        { type: "code_execution_call", command: "cargo test" },
        { type: "function_call", name: "write_file", args: { path: "out.md" } }
      ]
    };

    const items = buildTimeline(interaction, events);

    const command = items.find((item) => item.kind === "command");
    expect(command?.body).toBe("cargo test");
    const write = items.find((item) => item.kind === "write_file" || item.kind === "function");
    expect(write?.body).toContain("out.md");
    expect(items.some((item) => item.body?.includes("wrong text"))).toBe(false);
  });

  it("returns the first non-empty line, truncated", () => {
    expect(firstLine("\n\nhello\nworld")).toBe("hello");
    expect(firstLine("x".repeat(200), 10)).toBe("xxxxxxxxx…");
    expect(firstLine("")).toBeUndefined();
    expect(firstLine(undefined)).toBeUndefined();
  });
});

describe("stream event merging", () => {
  it("keeps legitimately identical deltas delivered in the same batch", () => {
    const delta = { event_type: "step.delta", index: 1, delta: { text: "\n\n" } };
    const merged = mergeStreamEvents([], [{ ...delta, seq: 10 }, { ...delta, seq: 11 }]);

    expect(merged).toHaveLength(2);
  });

  it("dedups a full id-less replay whose events carry fresh seq stamps", () => {
    // The live API currently sends no event ids, and a reconnect replays the
    // whole stream with new local seqs — content identity must absorb it.
    const original: InteractionStreamEvent[] = [
      { event_type: "step.start", index: 0, step: { type: "thought" }, seq: 1 },
      { event_type: "step.delta", index: 0, delta: { text: "hello" }, seq: 2 },
      { event_type: "step.delta", index: 0, delta: { text: "hello" }, seq: 3 }
    ];
    const replayed = original.map((event, position) => ({ ...event, seq: 100 + position }));
    const merged = mergeStreamEvents(original, replayed);

    expect(merged).toHaveLength(3);
    expect(merged.map((event) => event.seq)).toEqual([1, 2, 3]);
  });

  it("appends replay events beyond the copies it already has", () => {
    const delta = { event_type: "step.delta", index: 0, delta: { text: "hi" } };
    const merged = mergeStreamEvents(
      [{ ...delta, seq: 1 }],
      [{ ...delta, seq: 50 }, { ...delta, seq: 51 }]
    );

    // First replay copy matches the existing one; the second is genuinely new.
    expect(merged).toHaveLength(2);
    expect(merged.map((event) => event.seq)).toEqual([1, 51]);
  });

  it("dedups the same event arriving via push and snapshot channels", () => {
    const event: InteractionStreamEvent = {
      event_type: "step.delta",
      index: 1,
      delta: { text: "hello" },
      seq: 42
    };
    const merged = mergeStreamEvents([event], [{ ...event }]);

    expect(merged).toHaveLength(1);
  });

  it("orders seq-stamped events canonically even when arrivals interleave", () => {
    const eventAt = (seq: number): InteractionStreamEvent => ({
      event_type: "step.delta",
      index: 0,
      delta: { text: `t${seq}` },
      seq
    });
    const merged = mergeStreamEvents([eventAt(5), eventAt(7)], [eventAt(6), eventAt(4)]);

    expect(merged.map((event) => event.seq)).toEqual([4, 5, 6, 7]);
  });

  it("dedups resume replays by server event_id even when seq stamps differ", () => {
    const original: InteractionStreamEvent = {
      event_type: "step.delta",
      event_id: "evt-9",
      index: 0,
      delta: { text: "hello" },
      seq: 10
    };
    // A resume with a stale last_event_id re-sends the event; the main
    // process stamps it with a fresh seq.
    const replayed = { ...original, seq: 500 };
    const merged = mergeStreamEvents([original], [replayed]);

    expect(merged).toHaveLength(1);
    expect(merged[0].seq).toBe(10);
  });

});

describe("interaction recovery semantics", () => {
  it("treats requires_action as a live, non-terminal state", () => {
    expect(interactionIsTerminal({ id: "int-1", status: "requires_action" })).toBe(false);
    expect(interactionIsTerminal({ id: "int-1", status: "completed" })).toBe(true);
  });

  const reconnectSession = (overrides: Partial<Session>): Session =>
    ({
      localId: "run-1",
      agentId: "gai-anything-v1",
      request: { agent: "gai-anything-v1", input: "hi", environment: "remote", store: true },
      seed: { id: "int-1", status: "in_progress" },
      startedAt: 1,
      ...overrides
    }) as Session;

  it("only offers reconnect for stored interactions", () => {
    expect(sessionCanReconnect(reconnectSession({}))).toBe(true);
    expect(
      sessionCanReconnect(
        reconnectSession({
          request: { agent: "gai-anything-v1", input: "hi", environment: "remote", store: false }
        })
      )
    ).toBe(false);
  });
});
