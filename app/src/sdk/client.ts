import {
  GEMINI_API_BASE_URL,
  GEMINI_API_REVISION,
  type AgentDefinition,
  type AgentListResponse,
  type GeminiClientOptions,
  type Interaction,
  type InteractionCreateRequest,
  type InteractionStreamEvent,
  type ManagedAgent
} from "./types";
import { validateAgentDefinition, validateInteractionCreate } from "./validation";

export class GeminiApiKeyMissingError extends Error {
  constructor() {
    super("GEMINI_API_KEY is required for live Gemini API calls.");
    this.name = "GeminiApiKeyMissingError";
  }
}

export class GeminiApiValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join("\n"));
    this.name = "GeminiApiValidationError";
    this.errors = errors;
  }
}

export class GeminiApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, message: string, details: unknown) {
    super(message);
    this.name = "GeminiApiError";
    this.status = status;
    this.details = details;
  }
}

export class GeminiApiConnectionError extends Error {
  readonly details: {
    method: string;
    url: string;
    causeName?: string;
    causeMessage: string;
    causeCode?: unknown;
  };

  constructor(method: string, url: string, cause: unknown) {
    const causeName = cause instanceof Error ? cause.name : undefined;
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`Could not reach Gemini API (${method} ${url}): ${causeMessage}`);
    this.name = "GeminiApiConnectionError";
    this.details = {
      method,
      url,
      causeName,
      causeMessage,
      causeCode: typeof cause === "object" && cause && "code" in cause ? cause.code : undefined
    };
  }
}

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

type SendOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

type RequestLifetime = {
  signal: AbortSignal;
  cleanup: () => void;
};

// Streams disable the overall timeout (interactions can run for many minutes),
// so a stalled connection needs its own guard: if no bytes arrive for this
// long, the read is abandoned instead of hanging the consumer forever.
export const STREAM_INACTIVITY_TIMEOUT_MS = 180_000;

const RETRY_BACKOFF_MS = [500, 1500];
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const isTransientError = (error: unknown): boolean => {
  if (error instanceof GeminiApiConnectionError) {
    return true;
  }
  return error instanceof GeminiApiError && RETRYABLE_STATUSES.has(error.status);
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class GeminiManagedAgentsClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly apiRevision: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? GEMINI_API_BASE_URL);
    this.apiRevision = options.apiRevision ?? GEMINI_API_REVISION;
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;

    if (!this.fetchImpl) {
      throw new Error("A fetch implementation is required.");
    }
  }

  async createAgent(agent: AgentDefinition): Promise<ManagedAgent> {
    const validation = validateAgentDefinition(agent);
    if (!validation.ok) {
      throw new GeminiApiValidationError(validation.errors);
    }
    return this.request<ManagedAgent>("POST", "/agents", validation.value);
  }

  async listAgents(): Promise<AgentListResponse> {
    return this.request<AgentListResponse>("GET", "/agents");
  }

  async getAgent(id: string): Promise<ManagedAgent> {
    return this.request<ManagedAgent>("GET", `/agents/${encodeURIComponent(id)}`);
  }

  async deleteAgent(id: string): Promise<void> {
    await this.request<void>("DELETE", `/agents/${encodeURIComponent(id)}`);
  }

  async createInteraction(request: InteractionCreateRequest): Promise<Interaction> {
    const validation = validateInteractionCreate(request);
    if (!validation.ok) {
      throw new GeminiApiValidationError(validation.errors);
    }
    return this.request<Interaction>("POST", "/interactions", validation.value);
  }

  async *createInteractionStream(
    request: InteractionCreateRequest,
    options: SendOptions = {}
  ): AsyncGenerator<InteractionStreamEvent> {
    const validation = validateInteractionCreate(request);
    if (!validation.ok) {
      throw new GeminiApiValidationError(validation.errors);
    }
    // The lifetime spans the whole stream, not just the headers: the caller's
    // abort signal must be able to cancel mid-body, or "Stop" is a no-op.
    const lifetime = this.createLifetime({ ...options, timeoutMs: 0 });
    try {
      const response = await this.send(
        "POST",
        "/interactions",
        { ...validation.value, stream: true },
        lifetime.signal
      );
      yield* this.readStreamResponse(response);
    } finally {
      lifetime.cleanup();
    }
  }

  async *resumeInteractionStream(
    id: string,
    options: SendOptions & { lastEventId?: string } = {}
  ): AsyncGenerator<InteractionStreamEvent> {
    const params = new URLSearchParams({ stream: "true" });
    if (options.lastEventId) {
      params.set("last_event_id", options.lastEventId);
    }
    const lifetime = this.createLifetime({ ...options, timeoutMs: 0 });
    try {
      const response = await this.send(
        "GET",
        `/interactions/${encodeURIComponent(id)}?${params.toString()}`,
        undefined,
        lifetime.signal
      );
      yield* this.readStreamResponse(response);
    } finally {
      lifetime.cleanup();
    }
  }

  async getInteraction(id: string): Promise<Interaction> {
    return this.request<Interaction>("GET", `/interactions/${encodeURIComponent(id)}`);
  }

  async deleteInteraction(id: string): Promise<void> {
    await this.request<void>("DELETE", `/interactions/${encodeURIComponent(id)}`);
  }

  async cancelInteraction(id: string): Promise<Interaction> {
    return this.request<Interaction>("POST", `/interactions/${encodeURIComponent(id)}/cancel`);
  }

  async downloadEnvironmentSnapshot(environmentId: string, options: SendOptions = {}): Promise<ArrayBuffer> {
    return this.requestBinary(
      "GET",
      `/files/environment-${encodeURIComponent(environmentId)}:download?alt=media`,
      undefined,
      options
    );
  }

  /**
   * Streaming variant of downloadEnvironmentSnapshot for large snapshots:
   * the caller consumes the body incrementally instead of buffering the whole
   * tar in memory, and must call `cleanup` when done (success or failure).
   */
  async downloadEnvironmentSnapshotStream(
    environmentId: string,
    options: SendOptions = {}
  ): Promise<{ stream: ReadableStream<Uint8Array>; cleanup: () => void }> {
    const lifetime = this.createLifetime(options);
    try {
      const response = await this.send(
        "GET",
        `/files/environment-${encodeURIComponent(environmentId)}:download?alt=media`,
        undefined,
        lifetime.signal
      );
      if (!response.ok) {
        const text = await response.text();
        throw new GeminiApiError(response.status, this.errorMessage(response.status, text), parseBody(text));
      }
      if (!response.body) {
        throw new Error("Gemini snapshot download did not include a body.");
      }
      return { stream: response.body, cleanup: lifetime.cleanup };
    } catch (error) {
      lifetime.cleanup();
      throw error;
    }
  }

  private requireApiKey(): string {
    if (!this.apiKey) {
      throw new GeminiApiKeyMissingError();
    }
    return this.apiKey;
  }

  private endpoint(path: string): string {
    const relativePath = path.startsWith("/") ? path.slice(1) : path;
    return `${this.baseUrl}/${relativePath}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    // Only idempotent GETs retry; replaying a failed POST /interactions would
    // create duplicate interactions.
    const maxAttempts = method === "GET" ? RETRY_BACKOFF_MS.length + 1 : 1;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.requestOnce<T>(method, path, body);
      } catch (error) {
        if (attempt >= maxAttempts || !isTransientError(error)) {
          throw error;
        }
        await sleep(RETRY_BACKOFF_MS[attempt - 1]!);
      }
    }
  }

  private async requestOnce<T>(method: string, path: string, body?: unknown): Promise<T> {
    const lifetime = this.createLifetime();
    try {
      const response = await this.send(method, path, body, lifetime.signal);
      const text = await response.text();

      if (!response.ok) {
        throw new GeminiApiError(response.status, this.errorMessage(response.status, text), parseBody(text));
      }

      if (!text) {
        return undefined as T;
      }
      const parsed = parseBody(text);
      if (typeof parsed === "string") {
        // A 200 with a non-JSON body (proxy page, captive portal) must not be
        // handed to callers typed as an Interaction/Agent.
        throw new GeminiApiError(
          response.status,
          "Gemini API returned an unexpected non-JSON response.",
          parsed.slice(0, 500)
        );
      }
      return parsed as T;
    } finally {
      lifetime.cleanup();
    }
  }

  private async requestBinary(
    method: string,
    path: string,
    body?: unknown,
    options: SendOptions = {}
  ): Promise<ArrayBuffer> {
    const lifetime = this.createLifetime(options);
    try {
      const response = await this.send(method, path, body, lifetime.signal);
      if (!response.ok) {
        const text = await response.text();
        throw new GeminiApiError(response.status, this.errorMessage(response.status, text), parseBody(text));
      }
      return await response.arrayBuffer();
    } finally {
      lifetime.cleanup();
    }
  }

  /**
   * Builds an AbortSignal that combines the caller's signal with the request
   * timeout. Callers must keep it alive until the response BODY is consumed —
   * detaching after headers made cancellation and timeouts silently stop
   * covering body reads.
   */
  private createLifetime(options: SendOptions = {}): RequestLifetime {
    const controller = new AbortController();
    const abortFromOuterSignal = (): void => {
      controller.abort(options.signal?.reason ?? new Error("Gemini API request was cancelled."));
    };
    if (options.signal?.aborted) {
      abortFromOuterSignal();
    } else {
      options.signal?.addEventListener("abort", abortFromOuterSignal, { once: true });
    }
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const timeout =
      timeoutMs > 0
        ? setTimeout(() => controller.abort(new Error(`Gemini API request timed out after ${timeoutMs}ms`)), timeoutMs)
        : undefined;
    return {
      signal: controller.signal,
      cleanup: () => {
        options.signal?.removeEventListener("abort", abortFromOuterSignal);
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    };
  }

  private async send(method: string, path: string, body: unknown, signal: AbortSignal): Promise<Response> {
    const apiKey = this.requireApiKey();
    const headers: Record<string, string> = {
      "x-goog-api-key": apiKey,
      "Api-Revision": this.apiRevision
    };

    const init: RequestInit = {
      method,
      headers,
      signal
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const url = this.endpoint(path);
    try {
      return await this.fetchImpl(url, init);
    } catch (error) {
      if (signal.aborted) {
        // Deliberate cancellations and timeouts must surface as themselves,
        // not as "could not reach Gemini API".
        throw signal.reason instanceof Error ? signal.reason : error;
      }
      throw new GeminiApiConnectionError(method, url, error);
    }
  }

  private errorMessage(status: number, text: string): string {
    const body = parseBody(text);
    if (typeof body === "object" && body && "error" in body) {
      const error = (body as { error?: { message?: string } }).error;
      if (error?.message) {
        return error.message;
      }
    }
    return `Gemini API request failed with HTTP ${status}`;
  }

  private async *readStreamResponse(response: Response): AsyncGenerator<InteractionStreamEvent> {
    if (!response.ok) {
      const text = await response.text();
      throw new GeminiApiError(response.status, this.errorMessage(response.status, text), parseBody(text));
    }
    if (!response.body) {
      throw new Error("Gemini streaming response did not include a body.");
    }

    for await (const event of readInteractionStream(response.body, {
      inactivityTimeoutMs: STREAM_INACTIVITY_TIMEOUT_MS
    })) {
      if (event.event_type === "error" || event.error) {
        throw new Error(event.error?.message ?? "Gemini interaction stream failed.");
      }
      yield event;
      if (event.event_type === "done") {
        // Some servers hold the connection open after the final event; don't
        // wait for the socket to close once the stream says it is finished.
        return;
      }
    }
  }
}

const parseBody = (text: string): unknown => {
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const parseSseMessage = (raw: string): InteractionStreamEvent | undefined => {
  const lines = raw.split(/\r?\n/);
  let eventName: string | undefined;
  let eventId: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    const separator = line.indexOf(":");
    const field = separator >= 0 ? line.slice(0, separator) : line;
    const value = separator >= 0 ? line.slice(separator + 1).replace(/^ /, "") : "";
    if (field === "event") {
      eventName = value;
    } else if (field === "id") {
      eventId = value;
    } else if (field === "data") {
      dataLines.push(value);
    }
  }

  const data = dataLines.join("\n");
  if (!data) {
    return undefined;
  }
  if (data.trim() === "[DONE]") {
    return { event_type: "done", event_id: eventId };
  }

  const parsed = parseBody(data);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      event_type: eventName ?? "message",
      event_id: eventId,
      data: parsed
    };
  }

  const event = parsed as InteractionStreamEvent;
  return {
    ...event,
    event_type: typeof event.event_type === "string" ? event.event_type : eventName ?? "message",
    event_id: typeof event.event_id === "string" ? event.event_id : eventId
  };
};

export async function* readInteractionStream(
  body: ReadableStream<Uint8Array>,
  options: { inactivityTimeoutMs?: number } = {}
): AsyncGenerator<InteractionStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const inactivityTimeoutMs = options.inactivityTimeoutMs ?? 0;
  const read = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    if (inactivityTimeoutMs <= 0) {
      return reader.read();
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(`Gemini interaction stream stalled: no data for ${inactivityTimeoutMs}ms.`)
              ),
            inactivityTimeoutMs
          );
        })
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split(/\r?\n\r?\n/);
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const event = parseSseMessage(chunk);
        if (event) {
          yield event;
        }
      }
    }

    buffer += decoder.decode();
    const event = parseSseMessage(buffer.trim());
    if (event) {
      yield event;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
