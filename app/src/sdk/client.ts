import { ApiError, GoogleGenAI } from "@google/genai";
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
    operation: string;
    causeName?: string;
    causeMessage: string;
  };

  constructor(operation: string, cause: unknown) {
    const causeName = cause instanceof Error ? cause.name : undefined;
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`Could not reach Gemini API (${operation}): ${causeMessage}`);
    this.name = "GeminiApiConnectionError";
    this.details = { operation, causeName, causeMessage };
  }
}

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

type SendOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

// Streams disable the overall timeout (interactions can run for many minutes),
// so a stalled connection needs its own guard: if no events arrive for this
// long, the read is abandoned instead of hanging the consumer forever.
export const STREAM_INACTIVITY_TIMEOUT_MS = 180_000;

// Long streams must not be cut by a request timeout; the inactivity watchdog
// is the real guard.
const STREAM_REQUEST_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");

/**
 * Thin adapter over the official @google/genai SDK, scoped to the Managed
 * Agents surface this app uses: agents CRUD, interactions (create/stream/
 * resume/poll/cancel), and environment snapshot downloads. The adapter keeps
 * this project's error taxonomy and stream-event contract stable while the
 * SDK owns transport, retries, and SSE parsing.
 */
export class GeminiManagedAgentsClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly apiRevision: string;
  private readonly timeoutMs: number;
  private ai?: GoogleGenAI;

  constructor(options: GeminiClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.apiRevision = options.apiRevision ?? GEMINI_API_REVISION;
    this.timeoutMs = options.timeoutMs ?? 300_000;

    // GEMINI_API_BASE_URL historically includes the version suffix
    // ("https://…googleapis.com/v1beta"); the SDK wants host and apiVersion
    // separately.
    const base = trimTrailingSlash(options.baseUrl ?? GEMINI_API_BASE_URL);
    const versionMatch = base.match(/^(.+)\/(v[0-9]+[a-z0-9]*)$/i);
    this.baseUrl = versionMatch ? versionMatch[1] : base;
    this.apiVersion = versionMatch ? versionMatch[2] : "v1beta";
  }

  private sdk(): GoogleGenAI {
    if (!this.apiKey) {
      throw new GeminiApiKeyMissingError();
    }
    this.ai ??= new GoogleGenAI({
      apiKey: this.apiKey,
      httpOptions: {
        baseUrl: this.baseUrl,
        apiVersion: this.apiVersion,
        headers: { "Api-Revision": this.apiRevision },
        timeout: this.timeoutMs,
        // Never auto-retry at the client level: replaying POST /interactions
        // would create duplicate runs. Idempotent calls opt in per request.
        retryOptions: { attempts: 1 }
      }
    });
    return this.ai;
  }

  /** Wraps an SDK call so failures surface in this project's error taxonomy. */
  private async call<T>(operation: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (
        error instanceof GeminiApiKeyMissingError ||
        error instanceof GeminiApiValidationError ||
        isAbortError(error)
      ) {
        // Deliberate cancellations and timeouts surface as themselves,
        // not as "could not reach Gemini API".
        throw error;
      }
      if (error instanceof ApiError) {
        throw new GeminiApiError(error.status, error.message, undefined);
      }
      // The agents/interactions submodules throw their own error hierarchy
      // (NotFoundError -> APIError -> GeminiNextGenAPIClientError), distinct
      // from the SDK's top-level ApiError. Duck-type on the numeric status.
      const status = (error as { status?: unknown }).status;
      if (error instanceof Error && typeof status === "number") {
        throw new GeminiApiError(status, error.message, (error as { error?: unknown }).error);
      }
      throw new GeminiApiConnectionError(operation, error);
    }
  }

  async createAgent(agent: AgentDefinition): Promise<ManagedAgent> {
    const validation = validateAgentDefinition(agent);
    if (!validation.ok) {
      throw new GeminiApiValidationError(validation.errors);
    }
    return this.call("createAgent", async () => {
      const created = await this.sdk().agents.create({ ...validation.value } as never);
      return created as unknown as ManagedAgent;
    });
  }

  async listAgents(): Promise<AgentListResponse> {
    return this.call("listAgents", async () => {
      const response = await this.sdk().agents.list(null, { maxRetries: 3 });
      return response as unknown as AgentListResponse;
    });
  }

  async getAgent(id: string): Promise<ManagedAgent> {
    return this.call("getAgent", async () => {
      const agent = await this.sdk().agents.get(id, null, { maxRetries: 3 });
      return agent as unknown as ManagedAgent;
    });
  }

  async deleteAgent(id: string): Promise<void> {
    await this.call("deleteAgent", () => this.sdk().agents.delete(id));
  }

  async createInteraction(request: InteractionCreateRequest): Promise<Interaction> {
    const validation = validateInteractionCreate(request);
    if (!validation.ok) {
      throw new GeminiApiValidationError(validation.errors);
    }
    return this.call("createInteraction", async () => {
      const interaction = await this.sdk().interactions.create({
        ...validation.value,
        stream: false
      } as never);
      return interaction as unknown as Interaction;
    });
  }

  async *createInteractionStream(
    request: InteractionCreateRequest,
    options: SendOptions = {}
  ): AsyncGenerator<InteractionStreamEvent> {
    const validation = validateInteractionCreate(request);
    if (!validation.ok) {
      throw new GeminiApiValidationError(validation.errors);
    }
    const stream = await this.call("createInteractionStream", () =>
      this.sdk().interactions.create({ ...validation.value, stream: true } as never, {
        timeout: STREAM_REQUEST_TIMEOUT_MS,
        fetchOptions: options.signal ? { signal: options.signal } : undefined
      })
    );
    yield* this.readStream(stream as unknown as AsyncIterable<unknown>);
  }

  async *resumeInteractionStream(
    id: string,
    options: SendOptions & { lastEventId?: string } = {}
  ): AsyncGenerator<InteractionStreamEvent> {
    const stream = await this.call("resumeInteractionStream", () =>
      this.sdk().interactions.get(
        id,
        {
          stream: true,
          ...(options.lastEventId ? { last_event_id: options.lastEventId } : {})
        } as never,
        {
          timeout: STREAM_REQUEST_TIMEOUT_MS,
          fetchOptions: options.signal ? { signal: options.signal } : undefined
        }
      )
    );
    yield* this.readStream(stream as unknown as AsyncIterable<unknown>);
  }

  async getInteraction(id: string): Promise<Interaction> {
    return this.call("getInteraction", async () => {
      const interaction = await this.sdk().interactions.get(id, null, { maxRetries: 3 });
      return interaction as unknown as Interaction;
    });
  }

  async deleteInteraction(id: string): Promise<void> {
    await this.call("deleteInteraction", () => this.sdk().interactions.delete(id));
  }

  async cancelInteraction(id: string): Promise<Interaction> {
    return this.call("cancelInteraction", async () => {
      const interaction = await this.sdk().interactions.cancel(id);
      return interaction as unknown as Interaction;
    });
  }

  /** Downloads an environment snapshot tar straight to disk via the SDK. */
  async downloadEnvironmentSnapshotTo(
    environmentId: string,
    downloadPath: string,
    options: SendOptions = {}
  ): Promise<void> {
    await this.call("downloadEnvironmentSnapshot", () =>
      this.sdk().files.download({
        file: `environment-${environmentId}`,
        downloadPath,
        config: options.signal ? ({ abortSignal: options.signal } as never) : undefined
      })
    );
  }

  /**
   * Iterates an SDK event stream under an inactivity watchdog and maps events
   * into this project's InteractionStreamEvent contract (the SDK's typed
   * events already use the same wire shape: event_type / event_id / index).
   */
  private async *readStream(
    stream: AsyncIterable<unknown>,
    inactivityTimeoutMs = STREAM_INACTIVITY_TIMEOUT_MS
  ): AsyncGenerator<InteractionStreamEvent> {
    const iterator = stream[Symbol.asyncIterator]();
    try {
      while (true) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let result: IteratorResult<unknown>;
        try {
          result = await Promise.race([
            iterator.next(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new Error(
                      `Gemini interaction stream stalled: no events for ${inactivityTimeoutMs}ms.`
                    )
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
        if (result.done) {
          return;
        }
        const event = result.value as InteractionStreamEvent;
        if (event.event_type === "error" || event.error) {
          throw new Error(event.error?.message ?? "Gemini interaction stream failed.");
        }
        yield event;
        if (event.event_type === "done") {
          // Some servers hold the connection open after the final event.
          return;
        }
      }
    } finally {
      // Fire-and-forget: awaiting return() on a stalled generator would block
      // behind the very read the watchdog just abandoned, holding the error
      // hostage. The SDK stream cancels its underlying reader on return().
      void iterator.return?.().catch(() => undefined);
    }
  }
}
