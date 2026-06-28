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

const resolveApiKey = (provided?: string): string | undefined => {
  if (provided) {
    return provided;
  }
  if (typeof process !== "undefined") {
    return process.env.GEMINI_API_KEY;
  }
  return undefined;
};

export class GeminiManagedAgentsClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly apiRevision: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiClientOptions = {}) {
    this.apiKey = resolveApiKey(options.apiKey);
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
    const response = await this.send(
      "POST",
      "/interactions",
      { ...validation.value, stream: true },
      {
        ...options,
        timeoutMs: validation.value.background ? 0 : options.timeoutMs
      }
    );

    yield* this.readStreamResponse(response);
  }

  async *resumeInteractionStream(
    id: string,
    options: SendOptions & { lastEventId?: string } = {}
  ): AsyncGenerator<InteractionStreamEvent> {
    const params = new URLSearchParams({ stream: "true" });
    if (options.lastEventId) {
      params.set("last_event_id", options.lastEventId);
    }
    const response = await this.send(
      "GET",
      `/interactions/${encodeURIComponent(id)}?${params.toString()}`,
      undefined,
      { ...options, timeoutMs: 0 }
    );

    yield* this.readStreamResponse(response);
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

  async downloadEnvironmentSnapshot(environmentId: string): Promise<ArrayBuffer> {
    return this.requestBinary(
      "GET",
      `/files/environment-${encodeURIComponent(environmentId)}:download?alt=media`
    );
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
    const response = await this.send(method, path, body);
    const text = await response.text();

    if (!response.ok) {
      throw new GeminiApiError(response.status, this.errorMessage(response.status, text), parseBody(text));
    }

    if (!text) {
      return undefined as T;
    }
    return parseBody(text) as T;
  }

  private async requestBinary(method: string, path: string, body?: unknown): Promise<ArrayBuffer> {
    const response = await this.send(method, path, body);
    if (!response.ok) {
      const text = await response.text();
      throw new GeminiApiError(response.status, this.errorMessage(response.status, text), parseBody(text));
    }
    return response.arrayBuffer();
  }

  private async send(
    method: string,
    path: string,
    body?: unknown,
    options: SendOptions = {}
  ): Promise<Response> {
    const apiKey = this.requireApiKey();
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

    try {
      const headers: Record<string, string> = {
        "x-goog-api-key": apiKey,
        "Api-Revision": this.apiRevision
      };

      const init: RequestInit = {
        method,
        headers,
        signal: controller.signal
      };

      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }

      const url = this.endpoint(path);
      try {
        return await this.fetchImpl(url, init);
      } catch (error) {
        throw new GeminiApiConnectionError(method, url, error);
      }
    } finally {
      options.signal?.removeEventListener("abort", abortFromOuterSignal);
      if (timeout) {
        clearTimeout(timeout);
      }
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

    for await (const event of readInteractionStream(response.body)) {
      if (event.event_type === "error" || event.error) {
        throw new Error(event.error?.message ?? "Gemini interaction stream failed.");
      }
      yield event;
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
  body: ReadableStream<Uint8Array>
): AsyncGenerator<InteractionStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
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
