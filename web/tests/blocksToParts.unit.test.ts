import { describe, expect, test } from "vitest";
import { blocksToParts, groupParts, settleParts } from "../src/chat/blocksToParts";
import type { ContentPart } from "../src/state/types";

describe("blocksToParts", () => {
  test("maps a full agent turn: thought, code call+result pairing, text", () => {
    const parts = blocksToParts(
      [
        { index: 0, type: "thought", done: true, text: "plan" },
        { index: 1, type: "code_execution_call", done: true, id: "c1", code: "print(2+2)" },
        { index: 2, type: "code_execution_result", done: true, callId: "c1", result: "4\n", isError: false },
        { index: 3, type: "model_output", done: true, text: "The answer is 4." },
      ],
      "r0",
    );
    expect(parts.map((p) => p.kind)).toEqual(["thought", "code", "text"]);
    const code = parts[1] as Extract<ContentPart, { kind: "code" }>;
    expect(code.runs).toHaveLength(1);
    expect(code.runs[0].code).toBe("print(2+2)");
    expect(code.runs[0].result).toBe("4\n");
    expect(code.done).toBe(true);
  });

  test("search call renders a running chip; its result marks it done", () => {
    const running = blocksToParts([{ index: 0, type: "google_search_call", done: false, query: "news" }], "r0");
    expect(running[0]).toMatchObject({ kind: "tool", activity: { tool: "google_search", status: "running" } });

    const done = blocksToParts(
      [
        { index: 0, type: "google_search_call", done: true, query: "news" },
        { index: 1, type: "google_search_result", done: true, result: {} },
      ],
      "r0",
    );
    expect(done[0]).toMatchObject({ kind: "tool", activity: { status: "done" } });
  });

  test("api keys are redacted from text, code, and results", () => {
    const parts = blocksToParts(
      [
        { index: 0, type: "code_execution_call", done: true, id: "c1", code: "key = 'AIzaSyAcAqviUepuBYide_XWeU_TMfQNQPKxWI'" },
        { index: 1, type: "code_execution_result", done: true, callId: "c1", result: "AIzaSyAcAqviUepuBYide_XWeU_TMfQNQPKxWI\n" },
        { index: 2, type: "model_output", done: true, text: "your key is AIzaSyAcAqviUepuBYide_XWeU_TMfQNQPKxWI" },
      ],
      "r0",
    );
    const blob = JSON.stringify(parts);
    expect(blob).not.toContain("AIzaSy");
    expect(blob).toContain("[api-key-redacted]");
  });

  test("ids are stable and round-prefixed; settleParts closes running chips and code", () => {
    const parts = blocksToParts(
      [
        { index: 2, type: "url_context_call", done: false, url: "https://x.dev/a" },
        { index: 3, type: "code_execution_call", done: false, id: "c9", code: "1+1" },
      ],
      "r3",
    );
    expect(parts[0].id).toBe("r3-2");
    const settled = settleParts(parts);
    expect(settled[0]).toMatchObject({ activity: { status: "done" } });
    expect(settled[1]).toMatchObject({ kind: "code", done: true });
  });
});

describe("groupParts", () => {
  const codePart = (id: string, code: string): ContentPart => ({
    kind: "code",
    id,
    runs: [{ code, result: "ok", done: true }],
    done: true,
  });
  const toolPart = (id: string, tool: "google_search" | "other" | "setup", label: string): ContentPart => ({
    kind: "tool",
    id,
    activity: { tool, label, status: "done", detail: `${label}-detail` },
  });

  test("consecutive code parts collapse into one multi-run expander", () => {
    const grouped = groupParts([codePart("a", "x=1"), codePart("b", "y=2"), codePart("c", "z=3")]);
    expect(grouped).toHaveLength(1);
    const code = grouped[0] as Extract<ContentPart, { kind: "code" }>;
    expect(code.runs.map((r) => r.code)).toEqual(["x=1", "y=2", "z=3"]);
  });

  test("thoughts interleaved between code runs merge too (one thought + one code group)", () => {
    const thought = (id: string, text: string): ContentPart => ({ kind: "thought", id, text });
    const grouped = groupParts([
      thought("t1", "plan A"),
      codePart("a", "x=1"),
      thought("t2", "plan B"),
      codePart("b", "y=2"),
      thought("t3", "plan C"),
      codePart("c", "z=3"),
    ]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({ kind: "thought", text: "plan A\n\nplan B\n\nplan C" });
    const code = grouped[1] as Extract<ContentPart, { kind: "code" }>;
    expect(code.runs.map((r) => r.code)).toEqual(["x=1", "y=2", "z=3"]);
  });

  test("consecutive same-tool chips merge with a count and accumulated detail", () => {
    const grouped = groupParts([
      toolPart("a", "other", "Reading files…"),
      toolPart("b", "other", "Reading files…"),
      toolPart("c", "other", "Reading files…"),
    ]);
    expect(grouped).toHaveLength(1);
    const chip = grouped[0] as Extract<ContentPart, { kind: "tool" }>;
    expect(chip.activity.count).toBe(3);
    expect(chip.activity.label).toBe("Reading files");
    expect(String(chip.activity.detail).match(/•/g)).toHaveLength(3);
  });

  test("substantial text breaks a working block (no merge across it)", () => {
    const longText = "x".repeat(200);
    const grouped = groupParts([
      toolPart("a", "google_search", "Searching: foo"),
      { kind: "text", id: "t", text: longText },
      toolPart("b", "google_search", "Searching: bar"),
    ]);
    expect(grouped).toHaveLength(3);
  });

  test("brief narration between code runs stays in place while code still merges", () => {
    const brief = (id: string, text: string): ContentPart => ({ kind: "text", id, text });
    const grouped = groupParts([
      codePart("a", "x=1"),
      brief("n1", "The 100th prime is 541. Computing the next one…"),
      codePart("b", "y=2"),
      brief("n2", "Sum of squares done."),
      codePart("c", "z=3"),
    ]);
    expect(grouped.map((p) => p.kind)).toEqual(["code", "text", "text"]);
    const code = grouped[0] as Extract<ContentPart, { kind: "code" }>;
    expect(code.runs.map((r) => r.code)).toEqual(["x=1", "y=2", "z=3"]);
  });

  test("code runs do not merge across file/tool chips, preserving visible step order", () => {
    const grouped = groupParts([
      codePart("a", "bash gai --help"),
      toolPart("write", "other", "Writing files…"),
      { kind: "text", id: "n", text: "Creating the script." },
      codePart("b", "bash gai tts --script-file /workspace/output/script.txt"),
    ]);
    expect(grouped.map((p) => p.kind)).toEqual(["code", "tool", "text", "code"]);
    expect((grouped[0] as Extract<ContentPart, { kind: "code" }>).runs.map((r) => r.code)).toEqual(["bash gai --help"]);
    expect((grouped[3] as Extract<ContentPart, { kind: "code" }>).runs.map((r) => r.code)).toEqual([
      "bash gai tts --script-file /workspace/output/script.txt",
    ]);
  });

  test("trailing brief text after the last work part is NOT swallowed into the block", () => {
    const grouped = groupParts([
      codePart("a", "x=1"),
      { kind: "text", id: "t", text: "Short final answer." },
    ]);
    expect(grouped.map((p) => p.kind)).toEqual(["code", "text"]);
  });

  test("searches merge under a canonical label", () => {
    const grouped = groupParts([
      toolPart("a", "google_search", "Searching: foo"),
      toolPart("b", "google_search", "Searching: bar"),
    ]);
    expect(grouped).toHaveLength(1);
    expect((grouped[0] as Extract<ContentPart, { kind: "tool" }>).activity.label).toBe("Searching the web");
  });

  test("setup narration chips never group", () => {
    const grouped = groupParts([toolPart("a", "setup", "Step one"), toolPart("b", "setup", "Step two")]);
    expect(grouped).toHaveLength(2);
  });
});
