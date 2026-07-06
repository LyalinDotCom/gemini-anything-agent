// Consumes the SDK's interaction SSE stream (step.* + interaction.* events) into
// ordered, incrementally-updated blocks. This is the browser-side port of
// gemini-api-cli src/lib/stream.ts handleEvent — same merge rules, SDK event shapes
// (verified live: args arrive via `arguments_delta` string fragments;
// environment_id arrives on interaction.completed).

export interface StreamBlock {
  index: number;
  /** step/content type: text | thought | model_output | image | audio | video | document |
   *  function_call | code_execution_call | code_execution_result | google_search_call |
   *  url_context_call | *_result | text_annotation | … (render defensively) */
  type: string;
  done: boolean;
  text?: string;
  data?: string;
  mimeType?: string;
  name?: string;
  id?: string;
  callId?: string;
  argumentsRaw?: string;
  arguments?: Record<string, unknown>;
  code?: string;
  result?: unknown;
  isError?: boolean;
  query?: string;
  url?: string;
  annotations?: unknown[];
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  thoughtTokens?: number;
  cachedTokens?: number;
}

export interface StreamMeta {
  interactionId: string;
  environmentId: string;
  status: string;
  lastEventId?: string;
  usage?: Usage;
}

export interface StreamOutcome extends StreamMeta {
  blocks: StreamBlock[];
}

// SDK event payloads are treated structurally; the union is wide and partly untyped.
type SdkEvent = Record<string, any>;

/** Cast an SDK create/get return (stream overloads erased by param casts) to an event stream. */
export function asEventStream(x: unknown): AsyncIterable<SdkEvent> {
  return x as AsyncIterable<SdkEvent>;
}

function readUsage(u: any): Usage | undefined {
  if (!u) return undefined;
  return {
    inputTokens: u.total_input_tokens ?? u.input_tokens,
    outputTokens: u.total_output_tokens ?? u.output_tokens,
    thoughtTokens: u.total_thought_tokens ?? u.thought_tokens,
    cachedTokens: u.total_cached_tokens ?? u.cached_tokens,
  };
}

function normalizeType(t: string): string {
  return t === "thought_summary" ? "thought" : t;
}

/** Merge a step.start / step.stop payload (authoritative fields) into a block. */
function mergeStepFields(block: StreamBlock, step: any): void {
  if (!step || typeof step !== "object") return;
  if (typeof step.text === "string" && step.text.length > (block.text?.length ?? 0)) block.text = step.text;
  if (Array.isArray(step.summary)) {
    const t = step.summary.map((s: any) => s?.text ?? "").join("");
    if (t.length > (block.text?.length ?? 0)) block.text = t;
  }
  if (typeof step.data === "string" && step.data.length > (block.data?.length ?? 0)) block.data = step.data;
  if (step.mime_type) block.mimeType = step.mime_type;
  if (step.name) block.name = step.name;
  if (step.id) block.id = step.id;
  if (step.call_id) block.callId = step.call_id;
  if (step.is_error !== undefined) block.isError = step.is_error;
  if (step.result !== undefined && block.result === undefined) block.result = step.result;
  if (step.query) block.query = step.query;
  if (step.url) block.url = step.url;
  if (step.arguments !== undefined) {
    if (typeof step.arguments === "string") {
      if (step.arguments.length > (block.argumentsRaw?.length ?? 0)) block.argumentsRaw = step.arguments;
    } else if (step.arguments && Object.keys(step.arguments).length > 0) {
      block.arguments = step.arguments;
      if (block.type === "code_execution_call" && typeof step.arguments.code === "string") {
        if (step.arguments.code.length > (block.code?.length ?? 0)) block.code = step.arguments.code;
      }
    }
  }
  // model_output steps may carry a full content array (non-streamed replays)
  if (Array.isArray(step.content)) {
    for (const c of step.content) {
      if (c?.type === "text" && typeof c.text === "string" && c.text.length > (block.text?.length ?? 0)) {
        block.text = c.text;
      }
      if (c?.type === "image" || c?.type === "audio" || c?.type === "video" || c?.type === "document") {
        block.type = c.type;
        if (typeof c.data === "string") block.data = c.data;
        if (c.mime_type) block.mimeType = c.mime_type;
      }
    }
  }
}

function mergeDelta(block: StreamBlock, delta: any): void {
  if (!delta || typeof delta !== "object") return;
  const dtype = typeof delta.type === "string" ? delta.type : "";

  if (dtype === "arguments_delta" || (dtype === "" && typeof delta.arguments === "string")) {
    block.argumentsRaw = (block.argumentsRaw ?? "") + (delta.arguments ?? "");
    return;
  }
  if (typeof delta.text === "string") block.text = (block.text ?? "") + delta.text;
  if (typeof delta.data === "string") block.data = (block.data ?? "") + delta.data;
  if (delta.mime_type) block.mimeType = delta.mime_type;
  if (delta.name) block.name = delta.name;
  if (delta.id) block.id = delta.id;
  if (delta.call_id) block.callId = delta.call_id;
  if (delta.is_error !== undefined) block.isError = delta.is_error;
  if (delta.query) block.query = delta.query;
  if (delta.url) block.url = delta.url;
  if (Array.isArray(delta.annotations)) {
    block.annotations = [...(block.annotations ?? []), ...delta.annotations];
  }
  if (delta.arguments !== undefined) {
    if (typeof delta.arguments === "string") {
      block.argumentsRaw = (block.argumentsRaw ?? "") + delta.arguments;
    } else if (delta.arguments && typeof delta.arguments === "object") {
      if (block.type === "code_execution_call" && typeof delta.arguments.code === "string") {
        block.code = (block.code ?? "") + delta.arguments.code;
      } else {
        block.arguments = { ...(block.arguments ?? {}), ...delta.arguments };
      }
    }
  }
  if (delta.result !== undefined) {
    if (typeof delta.result === "string") {
      block.result = ((block.result as string) ?? "") + delta.result;
    } else {
      block.result = delta.result;
    }
  }
}

function finalizeBlock(block: StreamBlock): void {
  block.done = true;
  if ((!block.arguments || Object.keys(block.arguments).length === 0) && block.argumentsRaw) {
    try {
      block.arguments = JSON.parse(block.argumentsRaw);
    } catch {
      // leave raw; caller can inspect argumentsRaw
    }
  }
  if (block.type === "code_execution_call" && !block.code && typeof block.arguments?.code === "string") {
    block.code = block.arguments.code;
  }
}

/** No events for this long → the stream is presumed dead (the RUN may be fine —
 *  callers recover by polling the interaction, which is the durable object). */
const DEFAULT_STALL_MS = 3 * 60 * 1000;

/**
 * Drain an interaction event stream. `onUpdate` fires after every event with the
 * current blocks (sorted) and meta — callers throttle rendering themselves.
 * A stall watchdog abandons silently-hung SSE reads: servers can cut long
 * connections without an error while the interaction completes server-side.
 */
export async function consumeInteractionStream(
  stream: AsyncIterable<SdkEvent>,
  onUpdate?: (blocks: StreamBlock[], meta: StreamMeta) => void,
  opts?: { stallMs?: number },
): Promise<StreamOutcome> {
  const blocks = new Map<number, StreamBlock>();
  const meta: StreamMeta = { interactionId: "", environmentId: "", status: "" };

  const sorted = (): StreamBlock[] => [...blocks.values()].sort((a, b) => a.index - b.index);

  const harvest = (ev: SdkEvent): void => {
    const it = ev.interaction;
    if (it && typeof it === "object") {
      if (it.id) meta.interactionId = it.id;
      if (it.status) meta.status = it.status;
      if (it.environment_id) meta.environmentId = it.environment_id;
      const u = readUsage(it.usage);
      if (u) meta.usage = u;
    }
    if (typeof ev.interaction_id === "string" && ev.interaction_id) meta.interactionId = ev.interaction_id;
    if (typeof ev.environment_id === "string" && ev.environment_id) meta.environmentId = ev.environment_id;
    if (typeof ev.status === "string" && ev.status) meta.status = ev.status;
    if (typeof ev.event_id === "string" && ev.event_id) meta.lastEventId = ev.event_id;
    const u = readUsage(ev.usage);
    if (u) meta.usage = u;
  };

  const stallMs = opts?.stallMs ?? DEFAULT_STALL_MS;
  const iterator = stream[Symbol.asyncIterator]();
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let result: IteratorResult<SdkEvent>;
    try {
      result = await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Network stream stalled — no events received")), stallMs);
        }),
      ]);
    } catch (e) {
      // Fire-and-forget cleanup: awaiting return() would block behind the very
      // read we just abandoned.
      void Promise.resolve(iterator.return?.()).catch(() => {});
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (result.done) break;
    const ev = result.value;
    harvest(ev);
    const index: number | undefined = ev.index ?? ev.step_index;

    if (ev.event_type === "step.start" && index !== undefined) {
      const stepType = normalizeType(ev.step?.type ?? "text");
      const block: StreamBlock = { index, type: stepType, done: false };
      mergeStepFields(block, ev.step);
      blocks.set(index, block);
    } else if (ev.event_type === "step.delta" && index !== undefined) {
      let block = blocks.get(index);
      if (!block) {
        const dtype = normalizeType(ev.delta?.type === "arguments_delta" ? "function_call" : (ev.delta?.type ?? "text"));
        block = { index, type: dtype, done: false };
        blocks.set(index, block);
      }
      mergeDelta(block, ev.delta);
    } else if (ev.event_type === "step.stop" && index !== undefined) {
      const block = blocks.get(index) ?? { index, type: normalizeType(ev.step?.type ?? "text"), done: false };
      mergeStepFields(block, ev.step);
      finalizeBlock(block);
      blocks.set(index, block);
    } else if (ev.event_type === "interaction.completed") {
      // Reconcile: the completed event carries the final steps (e.g. thought summaries
      // that never streamed). Fill gaps without clobbering accumulated content.
      const finalSteps = ev.interaction?.steps;
      if (Array.isArray(finalSteps)) {
        finalSteps.forEach((step: any, i: number) => {
          const block = blocks.get(i) ?? { index: i, type: normalizeType(step?.type ?? "text"), done: false };
          mergeStepFields(block, step);
          blocks.set(i, block);
        });
      }
    }

    onUpdate?.(sorted(), { ...meta });
  }

  for (const block of blocks.values()) {
    if (!block.done) finalizeBlock(block);
  }

  return { ...meta, blocks: sorted() };
}

/** Blocks from a non-streaming Interaction resource (deep-research polling, gets). */
export function blocksFromInteraction(interaction: Record<string, any>): StreamOutcome {
  const blocks: StreamBlock[] = [];
  const steps: any[] = Array.isArray(interaction?.steps) ? interaction.steps : [];
  steps.forEach((step, i) => {
    if (step?.type === "model_output" && Array.isArray(step.content)) {
      for (const c of step.content) {
        const block: StreamBlock = { index: blocks.length, type: normalizeType(c?.type ?? "text"), done: true };
        if (typeof c?.text === "string") block.text = c.text;
        if (typeof c?.data === "string") block.data = c.data;
        if (c?.mime_type) block.mimeType = c.mime_type;
        blocks.push(block);
      }
      return;
    }
    const block: StreamBlock = { index: blocks.length, type: normalizeType(step?.type ?? `step_${i}`), done: true };
    mergeStepFields(block, step);
    finalizeBlock(block);
    blocks.push(block);
  });
  return {
    interactionId: interaction?.id ?? "",
    environmentId: interaction?.environment_id ?? "",
    status: interaction?.status ?? "",
    usage: readUsage(interaction?.usage),
    blocks,
  };
}
