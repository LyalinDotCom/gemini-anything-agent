import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ctorOptions: [] as Array<Record<string, unknown>>,
  agents: {
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    delete: vi.fn()
  },
  interactions: {
    create: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    cancel: vi.fn()
  },
  files: {
    download: vi.fn()
  }
}));

vi.mock("@google/genai", () => {
  class ApiError extends Error {
    status: number;
    constructor(options: { message: string; status: number }) {
      super(options.message);
      this.name = "ApiError";
      this.status = options.status;
    }
  }
  class GoogleGenAI {
    agents = mocks.agents;
    interactions = mocks.interactions;
    files = mocks.files;
    constructor(options: Record<string, unknown>) {
      mocks.ctorOptions.push(options);
    }
  }
  return { GoogleGenAI, ApiError };
});

import { ApiError } from "@google/genai";
import {
  GeminiApiConnectionError,
  GeminiApiError,
  GeminiApiKeyMissingError,
  GeminiApiValidationError,
  GeminiManagedAgentsClient
} from "../src/sdk";

const client = (overrides: Record<string, unknown> = {}) =>
  new GeminiManagedAgentsClient({ apiKey: "test-key", ...overrides });

const streamOf = (events: unknown[], options: { hang?: boolean } = {}) => ({
  async *[Symbol.asyncIterator]() {
    for (const event of events) {
      yield event;
    }
    if (options.hang) {
      await new Promise(() => undefined); // never settles
    }
  }
});

const validRequest = {
  agent: "gemini-anything-v1",
  input: "hello",
  environment: "remote" as const,
  store: true
};

beforeEach(() => {
  mocks.ctorOptions.length = 0;
  for (const group of [mocks.agents, mocks.interactions, mocks.files]) {
    for (const fn of Object.values(group)) {
      fn.mockReset();
    }
  }
});

describe("GenAI SDK adapter", () => {
  it("requires an API key before any live call", async () => {
    const bare = new GeminiManagedAgentsClient({});
    await expect(bare.getInteraction("int-1")).rejects.toBeInstanceOf(GeminiApiKeyMissingError);
    expect(mocks.interactions.get).not.toHaveBeenCalled();
  });

  it("splits the versioned base URL and configures headers and no auto-retries", async () => {
    mocks.interactions.get.mockResolvedValue({ id: "int-1" });
    await client({
      baseUrl: "https://example.test/v1beta",
      apiRevision: "2026-05-20"
    }).getInteraction("int-1");

    const options = mocks.ctorOptions[0] as {
      apiKey: string;
      httpOptions: { baseUrl: string; apiVersion: string; headers: Record<string, string>; retryOptions: { attempts: number } };
    };
    expect(options.apiKey).toBe("test-key");
    expect(options.httpOptions.baseUrl).toBe("https://example.test");
    expect(options.httpOptions.apiVersion).toBe("v1beta");
    expect(options.httpOptions.headers["Api-Revision"]).toBe("2026-05-20");
    // POST /interactions must never be silently replayed by client retries.
    expect(options.httpOptions.retryOptions.attempts).toBe(1);
  });

  it("ignores blank API override options", async () => {
    mocks.interactions.get.mockResolvedValue({ id: "int-1" });
    await client({
      baseUrl: "  ",
      apiRevision: ""
    }).getInteraction("int-1");

    const options = mocks.ctorOptions[0] as {
      httpOptions: { baseUrl: string; apiVersion: string; headers: Record<string, string> };
    };
    expect(options.httpOptions.baseUrl).toBe("https://generativelanguage.googleapis.com");
    expect(options.httpOptions.apiVersion).toBe("v1beta");
    expect(options.httpOptions.headers["Api-Revision"]).toBe("2026-05-20");
  });

  it("validates interaction requests before calling the SDK", async () => {
    await expect(
      client().createInteraction({ ...validRequest, store: false, background: true })
    ).rejects.toBeInstanceOf(GeminiApiValidationError);
    expect(mocks.interactions.create).not.toHaveBeenCalled();
  });

  it("creates non-streaming interactions with stream:false and normalized fields", async () => {
    mocks.interactions.create.mockResolvedValue({ id: "int-1", status: "in_progress" });
    const interaction = await client().createInteraction({ ...validRequest, background: true });

    expect(interaction.id).toBe("int-1");
    const params = mocks.interactions.create.mock.calls[0][0];
    expect(params).toMatchObject({
      agent: "gemini-anything-v1",
      input: "hello",
      environment: "remote",
      store: true,
      background: true,
      stream: false
    });
  });

  it("validates agent definitions before creating agents", async () => {
    await expect(
      client().createAgent({ id: "x", base_agent: "not-a-real-base" as never })
    ).rejects.toBeInstanceOf(GeminiApiValidationError);
    expect(mocks.agents.create).not.toHaveBeenCalled();
  });

  it("maps SDK ApiError to GeminiApiError with the HTTP status", async () => {
    mocks.agents.get.mockRejectedValue(new ApiError({ message: "unknown agent name", status: 404 }));
    const error = await client().getAgent("missing").catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(GeminiApiError);
    expect((error as GeminiApiError).status).toBe(404);
    expect((error as GeminiApiError).message).toContain("unknown agent name");
  });

  it("returns clone-safe plain data from SDK response models", async () => {
    const cyclic: Record<string, unknown> = { keep: "yes" };
    cyclic.self = cyclic;
    const response = Object.assign(new (class AgentModel {
      helper() {
        return "sdk helper";
      }
    })(), {
      id: "gemini-anything-v1",
      base_agent: "antigravity-preview-05-2026",
      created_at: new Date("2026-07-05T12:00:00.000Z"),
      metadata: new Map([["mode", "test"]]),
      nested: {
        keep: "value",
        helper: () => "not cloneable",
        cyclic
      },
      sdkHttpResponse: {
        headers: { "content-type": "application/json" },
        responseInternal: new Response("{}"),
        json: async () => ({})
      },
      ownHelper: () => "not cloneable",
      [Symbol("sdk")]: "not cloneable"
    });
    Object.defineProperty(response, "transport", {
      value: { request: "internal" },
      enumerable: false
    });
    mocks.agents.get.mockResolvedValue(response);

    const agent = await client().getAgent("gemini-anything-v1");

    expect(() => structuredClone(agent)).not.toThrow();
    expect(Object.getPrototypeOf(agent)).toBe(Object.prototype);
    expect(agent).toMatchObject({
      id: "gemini-anything-v1",
      base_agent: "antigravity-preview-05-2026",
      created_at: "2026-07-05T12:00:00.000Z",
      metadata: { mode: "test" },
      nested: {
        keep: "value",
        cyclic: { keep: "yes" }
      }
    });
    expect(agent).not.toHaveProperty("ownHelper");
    expect(agent).not.toHaveProperty("transport");
    expect(agent).not.toHaveProperty("sdkHttpResponse");
    expect((agent.nested as Record<string, unknown>)).not.toHaveProperty("helper");
  });

  it("wraps transport failures as connection errors but lets aborts surface as themselves", async () => {
    mocks.interactions.get.mockRejectedValue(new TypeError("fetch failed"));
    await expect(client().getInteraction("int-1")).rejects.toBeInstanceOf(GeminiApiConnectionError);

    const abort = new Error("stream cancelled");
    abort.name = "AbortError";
    mocks.interactions.get.mockRejectedValue(abort);
    await expect(client().getInteraction("int-1")).rejects.toBe(abort);
  });

  it("requests idempotent GET retries from the SDK", async () => {
    mocks.interactions.get.mockResolvedValue({ id: "int-1" });
    await client().getInteraction("int-1");
    expect(mocks.interactions.get).toHaveBeenCalledWith("int-1", null, { maxRetries: 3 });
  });

  it("streams interaction events and throws on stream error events", async () => {
    mocks.interactions.create.mockResolvedValue(
      streamOf([
        { event_type: "step.start", index: 0, step: { type: "model_output" }, event_id: "evt-1" },
        { event_type: "error", error: { message: "boom" } }
      ])
    );

    const events: unknown[] = [];
    const consume = async () => {
      for await (const event of client().createInteractionStream(validRequest)) {
        events.push(event);
      }
    };

    await expect(consume()).rejects.toThrow("boom");
    expect(events).toHaveLength(1);
    const params = mocks.interactions.create.mock.calls[0][0];
    expect(params.stream).toBe(true);
  });

  it("passes the caller's abort signal through to the SDK stream request", async () => {
    mocks.interactions.create.mockResolvedValue(streamOf([{ event_type: "done" }]));
    const controller = new AbortController();

    for await (const _event of client().createInteractionStream(validRequest, {
      signal: controller.signal
    })) {
      // drain
    }

    const requestOptions = mocks.interactions.create.mock.calls[0][1];
    expect(requestOptions.fetchOptions.signal).toBe(controller.signal);
  });

  it("resumes streams from the last event id and stops on the done event", async () => {
    mocks.interactions.get.mockResolvedValue(
      streamOf(
        [
          { event_type: "step.delta", index: 0, delta: { text: "hi" }, event_id: "evt-4" },
          { event_type: "done" },
          { event_type: "step.delta", index: 0, delta: { text: "never seen" } }
        ],
        { hang: true }
      )
    );

    const events: Array<{ event_type: string }> = [];
    for await (const event of client().resumeInteractionStream("int-1", { lastEventId: "evt-3" })) {
      events.push(event as { event_type: string });
    }

    expect(events.map((event) => event.event_type)).toEqual(["step.delta", "done"]);
    const [id, params] = mocks.interactions.get.mock.calls[0];
    expect(id).toBe("int-1");
    expect(params).toMatchObject({ stream: true, last_event_id: "evt-3" });
  });

  it("abandons a stalled stream via the inactivity watchdog", async () => {
    vi.useFakeTimers();
    try {
      mocks.interactions.create.mockResolvedValue(streamOf([], { hang: true }));

      const consume = (async () => {
        for await (const _event of client().createInteractionStream(validRequest)) {
          // never yields
        }
      })();
      const guarded = expect(consume).rejects.toThrow(/stalled/);
      // Let the generator reach the read race and register its watchdog timer
      // before advancing the clock past the inactivity deadline.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(180_001);
      await guarded;
    } finally {
      vi.useRealTimers();
    }
  });

  it("downloads environment snapshots to a path via the SDK files API", async () => {
    mocks.files.download.mockResolvedValue(undefined);
    await client().downloadEnvironmentSnapshotTo("env-42", "/tmp/snapshot.tar");

    expect(mocks.files.download).toHaveBeenCalledWith(
      expect.objectContaining({
        file: "environment-env-42",
        downloadPath: "/tmp/snapshot.tar"
      })
    );
  });
});
