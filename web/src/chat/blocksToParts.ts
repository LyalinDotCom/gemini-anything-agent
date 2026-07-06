// Pure mapping: adapter StreamBlocks → renderable ContentParts, plus the grouping
// pass that keeps chat history clean (desktop-app style): consecutive code runs
// collapse into ONE expander, consecutive same-tool actions collapse into one chip
// with a counter. Called on every stream tick — must stay cheap and total.
import type { StreamBlock } from "../gemini/streamAdapter";
import type { CodeRun, ContentPart, ToolActivity } from "../state/types";

// Defense-in-depth: the persona forbids printing the API key, but if the agent ever
// echoes one anyway, scrub it before it reaches the screen or IndexedDB.
const KEY_PATTERN = /AIza[0-9A-Za-z_-]{30,}/g;
function redact(s: string | undefined): string {
  return (s ?? "").replace(KEY_PATTERN, "[api-key-redacted]");
}

/** Controller stamps this onto image blocks once the bytes are persisted to IDB. */
export interface MediaStampedBlock extends StreamBlock {
  mediaRef?: { mediaId: string; mimeType: string };
}

function hostnameOf(url: string | undefined): string {
  if (!url) return "page";
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 40);
  }
}

function chip(id: string, activity: ToolActivity): ContentPart {
  return { kind: "tool", id, activity };
}

export function blocksToParts(blocks: MediaStampedBlock[], roundPrefix: string): ContentPart[] {
  const parts: ContentPart[] = [];
  const codeByCallId = new Map<string, Extract<ContentPart, { kind: "code" }>>();
  let lastCode: Extract<ContentPart, { kind: "code" }> | null = null;

  for (const b of blocks) {
    const id = `${roundPrefix}-${b.index}`;
    switch (b.type) {
      case "text":
      case "model_output": {
        if (b.text) parts.push({ kind: "text", id, text: redact(b.text) });
        break;
      }
      case "thought": {
        if (b.text) parts.push({ kind: "thought", id, text: redact(b.text) });
        break;
      }
      case "code_execution_call": {
        const part: Extract<ContentPart, { kind: "code" }> = {
          kind: "code",
          id,
          runs: [{ callId: b.id, code: redact(b.code), done: b.done }],
          done: b.done,
        };
        parts.push(part);
        if (b.id) codeByCallId.set(b.id, part);
        lastCode = part;
        break;
      }
      case "code_execution_result": {
        const target = (b.callId && codeByCallId.get(b.callId)) || lastCode;
        if (target) {
          const run = target.runs[target.runs.length - 1];
          run.result = redact(typeof b.result === "string" ? b.result : JSON.stringify(b.result ?? ""));
          run.isError = b.isError;
          run.done = true;
          target.done = true;
        }
        break;
      }
      case "google_search_call": {
        parts.push(
          chip(id, {
            tool: "google_search",
            label: b.query ? `Searching: ${b.query}` : "Searching the web",
            status: b.done ? "done" : "running",
            detail: b.query,
          }),
        );
        break;
      }
      case "google_search_result": {
        markLastRunning(parts, "google_search");
        break;
      }
      case "url_context_call": {
        parts.push(
          chip(id, {
            tool: "url_context",
            label: `Reading ${hostnameOf(b.url)}`,
            status: b.done ? "done" : "running",
            detail: b.url,
          }),
        );
        break;
      }
      case "url_context_result": {
        markLastRunning(parts, "url_context");
        break;
      }
      case "function_call": {
        const envLabel = b.name ? ENV_TOOL_LABELS[b.name] : undefined;
        parts.push(
          chip(id, {
            tool: envLabel ? "other" : "function",
            label: envLabel ? `${envLabel}…` : `Calling ${b.name ?? "function"}…`,
            status: "running", // settled by a following function_result or at turn end
            callId: b.id,
            detail: typeof b.arguments?.explanation === "string" ? b.arguments.explanation : b.argumentsRaw,
          }),
        );
        break;
      }
      case "image": {
        if (b.mediaRef) {
          parts.push({
            kind: "image",
            id,
            mediaId: b.mediaRef.mediaId,
            mimeType: b.mediaRef.mimeType,
            origin: "agent",
          });
        } else {
          parts.push(chip(id, { tool: "other", label: b.done ? "Processing image…" : "Receiving image…", status: "running" }));
        }
        break;
      }
      case "audio":
      case "video":
      case "document": {
        parts.push(chip(id, { tool: "other", label: `Receiving ${b.type}…`, status: b.done ? "done" : "running" }));
        break;
      }
      case "function_result": {
        // Server-fulfilled tool finished (workspace tools etc.) — settle its chip.
        markLastRunning(parts, "other") || markLastRunning(parts, "function") || markLastRunning(parts, "generate_image");
        break;
      }
      case "thought_signature":
      case "text_annotation": {
        break; // internal/no visual representation
      }
      default: {
        if (b.text) parts.push({ kind: "text", id, text: redact(b.text) });
        break;
      }
    }
  }
  return parts;
}

const ENV_TOOL_LABELS: Record<string, string> = {
  list_files: "Checking workspace",
  read_file: "Reading files",
  write_file: "Writing files",
  delete_file: "Cleaning workspace",
  bash: "Running a command",
  str_replace: "Editing files",
};

function markLastRunning(parts: ContentPart[], tool: ToolActivity["tool"]): boolean {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.kind === "tool" && p.activity.tool === tool && p.activity.status === "running") {
      p.activity.status = "done";
      return true;
    }
  }
  return false;
}

// ---- grouping ---------------------------------------------------------------

const GROUP_LABELS: Partial<Record<ToolActivity["tool"], string>> = {
  google_search: "Searching the web",
  url_context: "Reading pages",
  generate_image: "Generating images",
  function: "Calling functions",
};

function groupKey(a: ToolActivity): string | null {
  if (a.tool === "setup") return null; // narration chips never group
  if (a.tool === "other") return `other:${a.label.replace(/[…\s]+$/, "")}`;
  return a.tool;
}

function detailLine(a: ToolActivity): string {
  const d = a.detail === undefined || a.detail === null ? "" : String(a.detail);
  if (d && d !== a.label) return `• ${a.label.replace(/[…\s]+$/, "")}\n${d}`;
  return `• ${a.label.replace(/[…\s]+$/, "")}`;
}

/**
 * Collapse similar actions so long agent turns don't spam the thread (desktop-app
 * style). Works over "working blocks": contiguous runs of thought/code/tool parts.
 * Brief narration lines the agent emits BETWEEN steps ("Now computing…") are
 * block-transparent: they render in place but don't stop code/thought/tool merging.
 * Substantial text and media anchor the flow and break blocks. Within a block, ALL
 * thoughts merge into one, ALL code runs merge into one expander, and same-tool
 * chips merge with a counter — each kept at its first-appearance position.
 */
export function groupParts(parts: ContentPart[]): ContentPart[] {
  const isBriefText = (p: ContentPart): boolean =>
    p.kind === "text" && p.text.length <= 160 && !/```|\n#/.test(p.text);
  const isWork = (p: ContentPart): boolean => p.kind === "thought" || p.kind === "code" || p.kind === "tool";

  const out: ContentPart[] = [];
  let i = 0;
  while (i < parts.length) {
    if (!isWork(parts[i])) {
      out.push(parts[i]);
      i++;
      continue;
    }

    // Collect the block: work parts, plus brief texts that sit BETWEEN work parts.
    const block: ContentPart[] = [];
    while (i < parts.length) {
      if (isWork(parts[i])) {
        block.push(parts[i++]);
        continue;
      }
      if (isBriefText(parts[i]) && i + 1 < parts.length && isWork(parts[i + 1])) {
        block.push(parts[i++]);
        continue;
      }
      break;
    }

    const merged: ContentPart[] = [];
    for (const item of block) {
      if (item.kind === "text") {
        merged.push(item); // brief narration stays in place, untouched
        continue;
      }
      if (item.kind === "thought") {
        const prev = merged.find((m): m is Extract<ContentPart, { kind: "thought" }> => m.kind === "thought");
        if (prev) {
          prev.text = `${prev.text}\n\n${item.text}`;
        } else {
          merged.push({ ...item });
        }
        continue;
      }
      if (item.kind === "code") {
        const prev = [...merged].reverse().find((m): m is Extract<ContentPart, { kind: "code" }> => m.kind === "code");
        if (prev) {
          prev.runs = [...prev.runs, ...item.runs];
          prev.done = prev.done && item.done;
        } else {
          merged.push({ ...item, runs: [...item.runs] });
        }
        continue;
      }
      // tool chips
      if (item.kind !== "tool") {
        merged.push(item); // unreachable for well-formed blocks; keeps TS narrowing honest
        continue;
      }
      const key = groupKey(item.activity);
      const prev =
        key === null
          ? undefined
          : [...merged]
              .reverse()
              .find((m): m is Extract<ContentPart, { kind: "tool" }> => m.kind === "tool" && groupKey(m.activity) === key);
      if (prev && key !== null) {
        const count = (prev.activity.count ?? 1) + (item.activity.count ?? 1);
        const status =
          prev.activity.status === "error" || item.activity.status === "error"
            ? "error"
            : prev.activity.status === "running" || item.activity.status === "running"
              ? "running"
              : "done";
        const baseDetail = prev.activity.count ? String(prev.activity.detail ?? "") : detailLine(prev.activity);
        prev.activity = {
          ...prev.activity,
          label: GROUP_LABELS[item.activity.tool] ?? prev.activity.label.replace(/[…\s]+$/, ""),
          status,
          count,
          detail: `${baseDetail}\n${detailLine(item.activity)}`,
        };
      } else {
        merged.push({ ...item, activity: { ...item.activity } });
      }
    }
    out.push(...merged);
  }
  return out;
}

/** Mark every still-running chip/code part as settled when the turn ends. */
export function settleParts(parts: ContentPart[], error = false): ContentPart[] {
  return parts.map((p) => {
    if (p.kind === "tool" && p.activity.status === "running") {
      return { ...p, activity: { ...p.activity, status: error ? "error" : "done" } };
    }
    if (p.kind === "code" && !p.done) {
      return { ...p, done: true, runs: p.runs.map((r) => ({ ...r, done: true })) };
    }
    return p;
  });
}

export type { CodeRun };
