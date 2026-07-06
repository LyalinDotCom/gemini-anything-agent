// Error normalization: every SDK/network failure becomes a FriendlyError with a kind
// the UI can render and (where known) a retry hint. Merges gaicli's status handling
// with Spark's handleGeminiError message heuristics.
export type ErrorKind =
  | "no-key"
  | "bad-key"
  | "rate-limit"
  | "not-found"
  | "conflict"
  | "bad-request"
  | "network"
  | "server"
  | "aborted"
  | "unknown";

export class FriendlyError extends Error {
  readonly kind: ErrorKind;
  readonly status?: number;
  readonly retryAfterSec?: number;

  constructor(kind: ErrorKind, message: string, opts?: { status?: number; retryAfterSec?: number }) {
    super(message);
    this.name = "FriendlyError";
    this.kind = kind;
    this.status = opts?.status;
    this.retryAfterSec = opts?.retryAfterSec;
  }
}

function extractStatus(e: unknown): number | undefined {
  const any = e as { status?: unknown; code?: unknown; message?: unknown };
  if (typeof any?.status === "number") return any.status;
  const msg = String(any?.message ?? "");
  const m = msg.match(/\bStatus (\d{3})\b/) ?? msg.match(/API error \((\d{3})\)/) ?? msg.match(/^(\d{3}) /);
  return m ? Number(m[1]) : undefined;
}

export function toFriendly(e: unknown): FriendlyError {
  if (e instanceof FriendlyError) return e;

  const raw = String((e as Error)?.message ?? e ?? "").trim();
  const low = raw.toLowerCase();
  const status = extractStatus(e);

  if ((e as Error)?.name === "AbortError" || low.includes("aborted")) {
    return new FriendlyError("aborted", "Stopped.");
  }
  if (low.includes("api key not valid") || low.includes("api_key_invalid") || status === 401 || status === 403) {
    return new FriendlyError("bad-key", "Gemini rejected the API key. Check it in Settings.", { status });
  }
  if (status === 429 || low.includes("resource_exhausted") || low.includes("quota") || low.includes("rate limit")) {
    const m = low.match(/retry in ([\d.]+)s/) ?? low.match(/retry after ([\d.]+)/);
    return new FriendlyError("rate-limit", "Gemini rate-limited this key — try again in a moment.", {
      status: 429,
      retryAfterSec: m ? Math.ceil(Number(m[1])) : undefined,
    });
  }
  if (status === 404 || low.includes("not_found") || low.includes("was not found")) {
    return new FriendlyError("not-found", raw || "Not found.", { status: 404 });
  }
  if (status === 409 || low.includes("already exists") || low.includes("conflict")) {
    return new FriendlyError("conflict", raw || "Already exists.", { status: 409 });
  }
  if (status !== undefined && status >= 500) {
    return new FriendlyError("server", "Gemini had a server hiccup — try again.", { status });
  }
  if (status === 400) {
    return new FriendlyError("bad-request", raw.replace(/^400\s*/, ""), { status });
  }
  if (low.includes("failed to fetch") || low.includes("network") || low.includes("load failed")) {
    return new FriendlyError("network", "Network problem — check your connection and retry.");
  }
  return new FriendlyError("unknown", raw || "Something went wrong.");
}
