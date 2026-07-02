import {
  extractInteractionOutputText,
  type Interaction,
  type InteractionStreamEvent
} from "@sdk";

/**
 * Folds the raw managed-agent firehose (158+ step.start/step.delta/step.stop
 * events, or a terminal interaction's `steps[]`) into a short list of semantic
 * activity items — Thinking, Run command, Write file, Tool call, Assistant —
 * the way a clean agent harness (Claude Code / Codex) shows a turn. The raw
 * events stay available untouched for the Raw tab; nothing here is lossy.
 */
export type ActivityKind =
  | "thinking"
  | "command"
  | "write_file"
  | "function"
  | "search"
  | "url"
  | "message"
  | "lifecycle"
  | "error"
  | "other";

export type TimelineStatus = "running" | "done" | "error";

export type TimelineDetail = {
  id: string;
  title: string;
  summary?: string;
  body?: string;
  markdown?: boolean;
  terminal?: boolean;
  status: TimelineStatus;
};

export type TimelineItem = {
  id: string;
  kind: ActivityKind;
  title: string;
  /** One-line preview shown collapsed. */
  summary?: string;
  /** Full detail revealed on expand. */
  body?: string;
  /** Render the body as Markdown (assistant answers). */
  markdown?: boolean;
  /** Treat the body as a terminal/command block. */
  terminal?: boolean;
  status: TimelineStatus;
  /** Consecutive same-kind actions are grouped but keep their original details. */
  count?: number;
  details?: TimelineDetail[];
};

const rec = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const imageSummary = (value: Record<string, unknown>): string | undefined => {
  const mime = str(value.mime_type) ?? str(value.mimeType) ?? "image";
  const data = str(value.data);
  if (data) {
    return `[${mime} ${Math.round((data.length * 3) / 4 / 1024)} KB]`;
  }
  return value.type === "image" ? `[${mime}]` : undefined;
};

const contentBlockText = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  const record = rec(value);
  if (!record) {
    return "";
  }
  return imageSummary(record) ?? str(record.text) ?? str(record.output) ?? str(record.summary) ?? "";
};

const contentText = (value: unknown): string => {
  if (!Array.isArray(value)) {
    return contentBlockText(value);
  }
  return value
    .map(contentBlockText)
    .filter((part): part is string => Boolean(part))
    .join("");
};

export const firstLine = (text: string | undefined, max = 96): string | undefined => {
  if (!text) {
    return undefined;
  }
  const line = text.trim().split("\n").find((entry) => entry.trim().length > 0)?.trim();
  if (!line) {
    return undefined;
  }
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

type Descriptor = { kind: ActivityKind; title: string };

const DESCRIPTORS: Record<string, Descriptor> = {
  thought: { kind: "thinking", title: "Thinking" },
  thinking: { kind: "thinking", title: "Thinking" },
  thought_summary: { kind: "thinking", title: "Thinking" },
  reasoning: { kind: "thinking", title: "Thinking" },
  code_execution_call: { kind: "command", title: "Run command" },
  code_execution: { kind: "command", title: "Run command" },
  code_execution_result: { kind: "command", title: "Command result" },
  bash: { kind: "command", title: "Run command" },
  function_call: { kind: "function", title: "Tool call" },
  function_result: { kind: "function", title: "Tool result" },
  tool_call: { kind: "function", title: "Tool call" },
  tool_result: { kind: "function", title: "Tool result" },
  model_output: { kind: "message", title: "Assistant" },
  output: { kind: "message", title: "Assistant" },
  google_search: { kind: "search", title: "Google Search" },
  google_search_call: { kind: "search", title: "Google Search" },
  google_search_result: { kind: "search", title: "Google Search result" },
  search_call: { kind: "search", title: "Google Search" },
  search_result: { kind: "search", title: "Google Search result" },
  web_search: { kind: "search", title: "Web search" },
  url_context: { kind: "url", title: "Fetch URL" },
  url_context_call: { kind: "url", title: "Fetch URL" },
  url_context_result: { kind: "url", title: "URL result" }
};

const RESULT_TYPES = new Set(["code_execution_result", "function_result", "tool_result"]);
const HIDDEN_STEP_TYPES = new Set(["user_input"]);
const MODEL_OUTPUT_TYPES = new Set(["model_output", "output"]);
const WRITE_FN = /(write|edit|create|save|patch|apply)_?file|writefile|str_replace/i;

const describe = (type: string): Descriptor =>
  DESCRIPTORS[type] ?? { kind: "other", title: type.replace(/_/g, " ") };

const jsonRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    return rec(JSON.parse(value));
  } catch {
    return undefined;
  }
};

const nestedArgs = (record: Record<string, unknown>): unknown => {
  const fn = rec(record.function);
  return record.args ?? record.arguments ?? record.parameters ?? fn?.arguments ?? fn?.parameters;
};

const commandText = (value: unknown): string | undefined => {
  const record = rec(value);
  if (!record) {
    return undefined;
  }
  const direct = str(record.command) ?? str(record.code) ?? str(record.input);
  if (direct) {
    return direct;
  }
  const args = nestedArgs(record);
  const argRecord = rec(args) ?? jsonRecord(args);
  return argRecord
    ? str(argRecord.command) ?? str(argRecord.code) ?? str(argRecord.input)
    : undefined;
};

/** Best-effort human text out of one streamed delta payload. */
const deltaText = (delta: unknown): string => {
  if (typeof delta === "string") {
    return delta;
  }
  const d = rec(delta);
  if (!d) {
    return "";
  }
  const deltaType = str(d.type);
  if (deltaType === "thought_signature") {
    return "";
  }
  if (deltaType === "thought_summary") {
    return contentText(d.content) || str(d.text) || str(d.summary) || "";
  }
  if (deltaType === "image") {
    return imageSummary(d) ?? "";
  }
  const command = commandText(d);
  if (command) {
    return command;
  }
  const name = str(d.name) ?? str(d.tool);
  const args = nestedArgs(d);
  if (name || (args !== undefined && typeof args !== "string")) {
    const argText =
      args !== undefined && args !== null
        ? `\n${typeof args === "string" ? args : JSON.stringify(args, null, 2)}`
        : "";
    return `${name ?? "function"}${argText}`;
  }
  return (
    str(d.text) ??
    str(d.code) ??
    str(d.output) ??
    str(d.command) ??
    str(d.thought) ??
    str(d.summary) ??
    str(d.arguments) ??
    str(d.args) ??
    str(d.parameters) ??
    str(d.delta) ??
    contentText(d.content) ??
    ""
  );
};

/**
 * Best-effort body text out of one terminal `steps[]` entry. `synthetic` marks
 * a body we could only produce by dumping JSON (no recognized field) so callers
 * can keep it for display without letting it skew source-selection scoring.
 */
const stepText = (step: unknown, type: string): { body: string; synthetic: boolean } => {
  const r = rec(step) ?? {};
  if (describe(type).kind === "message") {
    return { body: contentText(r.content) || contentText(r.output) || str(r.text) || "", synthetic: false };
  }
  const command = commandText(r);
  const output = str(r.output) ?? str(r.stdout) ?? str(r.result) ?? str(r.stderr);
  if (command || output) {
    return { body: [command, output].filter(Boolean).join("\n"), synthetic: false };
  }
  const prose = str(r.summary) || contentText(r.summary) || str(r.thought) || str(r.text) || contentText(r.content);
  if (prose) {
    return { body: prose, synthetic: false };
  }
  if (describe(type).kind === "thinking") {
    return { body: "", synthetic: true };
  }
  const name = str(r.name) ?? str(r.tool);
  const args = nestedArgs(r);
  if (name || args) {
    const argText = args ? `\n${typeof args === "string" ? args : JSON.stringify(args, null, 2)}` : "";
    return { body: `${name ?? "function"}${argText}`, synthetic: false };
  }
  return { body: JSON.stringify(step, null, 2).slice(0, 4000), synthetic: true };
};

type Mut = {
  type: string;
  text: string;
  status: TimelineStatus;
  synthetic?: boolean;
  /** The step's position in the interaction's steps[] when explicitly known. */
  index?: number;
};

const normalizedText = (value: string): string => value.trim().replace(/\s+/g, " ");

const foldNarrationIntoThinking = (muts: Mut[], finalText: string | undefined): Mut[] => {
  if (!finalText) {
    return muts;
  }
  const final = normalizedText(finalText);
  return muts.flatMap((mut) => {
    if (!MODEL_OUTPUT_TYPES.has(mut.type)) {
      return [mut];
    }

    // When the model_output is just the final answer echoed in steps/events,
    // drop it and render the authoritative output_text once at the end.
    if (!mut.text.trim() || normalizedText(mut.text) === final) {
      return [];
    }

    return [{ ...mut, type: "thought_summary" }];
  });
};

const refine = (item: TimelineItem, type: string): TimelineItem => {
  // A write-style function call reads better as "Write file <path>".
  if (item.kind === "function" && WRITE_FN.test(type + " " + (item.body ?? ""))) {
    const path = item.body?.match(/["']?(?:path|file|target)["']?\s*[:=]\s*["']([^"']+)["']/i)?.[1];
    return { ...item, kind: "write_file", title: "Write file", summary: path ?? item.summary };
  }
  return item;
};

const mutsToItems = (muts: Mut[]): TimelineItem[] => {
  const items: TimelineItem[] = [];
  for (const mut of muts) {
    const text = mut.text.trim();
    // Fold a result step into the preceding call so each tool use is one row.
    if (RESULT_TYPES.has(mut.type) && items.length > 0) {
      const prev = items[items.length - 1];
      if (prev.kind === "command" || prev.kind === "function" || prev.kind === "write_file") {
        const combined = [prev.body, text].filter(Boolean).join("\n");
        items[items.length - 1] = {
          ...prev,
          body: combined,
          status: mut.status === "error" ? "error" : prev.status,
          summary: prev.summary ?? firstLine(prev.body) ?? firstLine(text)
        };
        continue;
      }
    }
    const { kind, title } = describe(mut.type);
    // Position-based id (no source prefix) so the same logical row keeps its key
    // when the source flips from the live event stream to terminal steps[].
    const item: TimelineItem = {
      id: String(items.length),
      kind,
      title,
      body: text || undefined,
      summary: firstLine(text),
      markdown: kind === "message",
      terminal: kind === "command",
      status: mut.status
    };
    items.push(refine(item, mut.type));
  }
  return items;
};

const isGroupable = (item: TimelineItem): boolean =>
  item.kind !== "message" && item.kind !== "error" && item.kind !== "lifecycle";

const detailFromItem = (item: TimelineItem): TimelineDetail => ({
  id: item.id,
  title: item.title,
  summary: item.summary,
  body: item.body,
  markdown: item.markdown,
  terminal: item.terminal,
  status: item.status
});

const detailBody = (detail: TimelineDetail): string =>
  [detail.summary && !detail.body?.includes(detail.summary) ? detail.summary : undefined, detail.body]
    .filter(Boolean)
    .join("\n");

const detailHasContent = (detail: TimelineDetail): boolean =>
  Boolean(detail.body?.trim() || detail.summary?.trim());

const itemHasContent = (item: TimelineItem): boolean =>
  Boolean(item.body?.trim() || item.summary?.trim() || item.details?.some(detailHasContent));

const mergeStatus = (details: TimelineDetail[]): TimelineStatus => {
  if (details.some((detail) => detail.status === "error")) {
    return "error";
  }
  if (details.some((detail) => detail.status === "running")) {
    return "running";
  }
  return "done";
};

const groupSummary = (details: TimelineDetail[]): string => {
  const latest = [...details]
    .reverse()
    .map((detail) => detail.summary ?? firstLine(detail.body))
    .find(Boolean);
  return latest ? `${details.length} events - ${latest}` : `${details.length} events`;
};

const groupBody = (details: TimelineDetail[]): string | undefined => {
  if (!details.some(detailHasContent)) {
    return undefined;
  }
  const text = details
    .map((detail, index) => {
      const body = detailBody(detail);
      return body ? `${index + 1}. ${detail.title}\n${body}` : `${index + 1}. ${detail.title}`;
    })
    .join("\n\n")
    .trim();
  return text || undefined;
};

const groupItems = (items: TimelineItem[]): TimelineItem[] => {
  const grouped: TimelineItem[] = [];
  for (const item of items) {
    const prev = grouped.at(-1);
    if (prev && isGroupable(prev) && isGroupable(item) && prev.kind === item.kind && prev.title === item.title) {
      const details = [...(prev.details ?? [detailFromItem(prev)]), detailFromItem(item)];
      grouped[grouped.length - 1] = {
        ...prev,
        summary: groupSummary(details),
        body: groupBody(details),
        terminal: false,
        markdown: false,
        status: mergeStatus(details),
        count: details.length,
        details
      };
      continue;
    }
    grouped.push(item);
  }
  return grouped;
};

const removeEmptyFinishedThinking = (items: TimelineItem[]): TimelineItem[] =>
  items.filter((item) => item.kind !== "thinking" || item.status === "running" || itemHasContent(item));

const fromEvents = (events: InteractionStreamEvent[]): Mut[] => {
  const byIndex = new Map<number, Mut>();
  const order: number[] = [];
  const indexOf = (event: InteractionStreamEvent): number =>
    typeof event.index === "number" ? event.index : order[order.length - 1] ?? 0;

  for (const event of events) {
    if (event.event_type === "step.start") {
      const explicitIndex = typeof event.index === "number" ? event.index : undefined;
      const index = explicitIndex ?? order.length;
      const type = str(rec(event.step)?.type) ?? "step";
      if (HIDDEN_STEP_TYPES.has(type)) {
        continue;
      }
      const existing = byIndex.get(index);
      if (existing) {
        existing.type = type;
      } else {
        byIndex.set(index, { type, text: "", status: "running", index: explicitIndex });
        order.push(index);
      }
    } else if (event.event_type === "step.delta") {
      const index = indexOf(event);
      const mut = byIndex.get(index);
      if (mut) {
        mut.text += deltaText(event.delta);
      } else if (typeof event.index === "number") {
        // The step.start for this index was evicted by the event cap; a
        // placeholder keeps the delta's text on its own step instead of
        // dropping it, and terminal hydration fills the real type by index.
        byIndex.set(index, {
          type: "step",
          text: deltaText(event.delta),
          status: "running",
          index
        });
        order.push(index);
      }
    } else if (event.event_type === "step.stop") {
      const mut = byIndex.get(indexOf(event));
      if (mut && mut.status === "running") {
        mut.status = "done";
      }
    }
  }
  return order.map((index) => byIndex.get(index)!).filter(Boolean);
};

const fromSteps = (steps: unknown[]): Mut[] =>
  steps
    .map((step, position): Mut | undefined => {
      const type = str(rec(step)?.type) ?? "step";
      if (HIDDEN_STEP_TYPES.has(type)) {
        return undefined;
      }
      const { body, synthetic } = stepText(step, type);
      return { type, text: body, status: "done" as const, synthetic, index: position };
    })
    .filter((mut): mut is Mut => Boolean(mut));

const isTerminalInteraction = (interaction: Interaction | undefined): boolean =>
  /completed|succeeded|failed|cancelled|canceled|error/i.test(String(interaction?.status ?? ""));

const hydrateEventMuts = (
  eventMuts: Mut[],
  stepMuts: Mut[],
  interaction: Interaction | undefined
): Mut[] => {
  // Match each streamed step to its terminal steps[] entry by the step's real
  // index. Positional alignment breaks as soon as the event cap evicts early
  // events: event-derived muts then start at some step N while steps[] starts
  // at 0, and text hydrates into the wrong rows.
  const stepsByIndex = new Map(
    stepMuts
      .filter((mut) => typeof mut.index === "number")
      .map((mut) => [mut.index as number, mut])
  );
  return eventMuts.map((mut, position) => {
    const step = typeof mut.index === "number" ? stepsByIndex.get(mut.index) : stepMuts[position];
    const hydratedText = mut.text.trim().length || step?.synthetic ? mut.text : step?.text ?? mut.text;
    return {
      ...mut,
      // Placeholder muts (evicted step.start) learn their real type here.
      type: mut.type === "step" && step ? step.type : mut.type,
      text: hydratedText,
      synthetic: mut.synthetic && step && !step.synthetic ? false : mut.synthetic,
      status: mut.status === "running" && (step?.status === "done" || isTerminalInteraction(interaction))
        ? "done"
        : mut.status
    };
  });
};

/**
 * Build the folded activity timeline for the agent's turn. Once we have a live
 * stream, keep that stream as the ordering source even after completion; the
 * terminal interaction can hydrate missed text and provide the final answer.
 */
export const buildTimeline = (
  interaction: Interaction | undefined,
  events: InteractionStreamEvent[] | undefined
): TimelineItem[] => {
  const stepMuts = Array.isArray(interaction?.steps) ? fromSteps(interaction!.steps!) : [];
  const eventMuts = events && events.length ? fromEvents(events) : [];
  const sourceMuts = eventMuts.length > 0 ? hydrateEventMuts(eventMuts, stepMuts, interaction) : stepMuts;
  const explicitFinalText = interaction?.output_text?.trim() ? interaction.output_text : undefined;
  const items = groupItems(removeEmptyFinishedThinking(mutsToItems(foldNarrationIntoThinking(sourceMuts, explicitFinalText))));

  // The authoritative answer text wins over any streamed fragment buffer.
  const finalText = extractInteractionOutputText(interaction);
  if (finalText) {
    const lastMessageIndex = [...items].reverse().findIndex((item) => item.kind === "message");
    if (lastMessageIndex >= 0) {
      const index = items.length - 1 - lastMessageIndex;
      items[index] = {
        ...items[index],
        body: finalText,
        summary: firstLine(finalText),
        markdown: true,
        status: "done"
      };
    } else {
      items.push({
        id: "final-message",
        kind: "message",
        title: "Assistant",
        body: finalText,
        summary: firstLine(finalText),
        markdown: true,
        status: "done"
      });
    }
  }

  return items;
};
