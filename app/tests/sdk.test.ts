import { describe, expect, it, vi } from "vitest";
import {
  GeminiApiConnectionError,
  GeminiApiKeyMissingError,
  GeminiManagedAgentsClient,
  createStarterAgentDefinition,
  extractInteractionOutputText,
  readInteractionStream,
  validateAgentDefinition,
  validateInteractionCreate
} from "../src/sdk";

describe("managed agents SDK", () => {
  it("normalizes starter definitions into the Gemini agent payload", () => {
    const result = validateAgentDefinition(createStarterAgentDefinition("agent-lab-test"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        id: "agent-lab-test",
        base_agent: "antigravity-preview-05-2026",
        tools: [
          { type: "code_execution" },
          { type: "google_search" },
          { type: "url_context" }
        ]
      });
      expect(result.value.base_environment).toMatchObject({
        type: "remote",
        sources: expect.arrayContaining([
          expect.objectContaining({
            type: "inline",
            target: ".agents/AGENTS.md"
          })
        ])
      });
    }
  });

  it("sends the expected create request headers and body", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ id: "agent-lab-test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const client = new GeminiManagedAgentsClient({
      apiKey: "test-key",
      fetch: fetchMock,
      timeoutMs: 1_000
    });

    await client.createAgent(createStarterAgentDefinition("agent-lab-test"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as Parameters<typeof fetch>;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/agents");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "x-goog-api-key": "test-key",
      "Api-Revision": "2026-05-20",
      "Content-Type": "application/json"
    });
    expect(JSON.parse(init?.body as string)).toMatchObject({
      id: "agent-lab-test",
      base_agent: "antigravity-preview-05-2026"
    });
  });

  it("requires interaction environment before making live calls", () => {
    const result = validateInteractionCreate({
      agent: "agent-lab-test",
      input: "hello"
    } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("environment");
    }
  });

  it("rejects background interactions when store is explicitly off", () => {
    const result = validateInteractionCreate({
      agent: "agent-lab-test",
      input: "hello",
      environment: "remote",
      store: false,
      background: true
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("background=true requires store=true");
    }
  });

  it("sends environment in interaction requests", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ id: "interaction-test", environment_id: "env-test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const client = new GeminiManagedAgentsClient({
      apiKey: "test-key",
      fetch: fetchMock,
      timeoutMs: 1_000
    });

    await client.createInteraction({
      agent: "agent-lab-test",
      input: "hello",
      environment: "remote",
      store: true
    });

    const [url, init] = fetchMock.mock.calls[0] as Parameters<typeof fetch>;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      agent: "agent-lab-test",
      input: "hello",
      environment: "remote",
      store: true
    });
  });

  it("sends GA interaction options in create requests", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ id: "interaction-test", status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const client = new GeminiManagedAgentsClient({
      apiKey: "test-key",
      fetch: fetchMock,
      timeoutMs: 1_000
    });

    await client.createInteraction({
      agent: "agent-lab-test",
      input: "hello",
      environment: "remote",
      store: true,
      background: true,
      service_tier: "flex",
      agent_config: {
        type: "dynamic",
        thinking_summaries: "auto"
      }
    });

    const [, init] = fetchMock.mock.calls[0] as Parameters<typeof fetch>;
    expect(JSON.parse(init?.body as string)).toMatchObject({
      agent: "agent-lab-test",
      input: "hello",
      environment: "remote",
      store: true,
      background: true,
      service_tier: "flex",
      agent_config: {
        type: "dynamic",
        thinking_summaries: "auto"
      }
    });
  });

  it("extracts final text from model_output steps when output_text is absent", () => {
    expect(
      extractInteractionOutputText({
        id: "interaction-test",
        status: "completed",
        environment_id: "env-test",
        steps: [
          {
            type: "thought",
            summary: [{ type: "text", text: "hidden reasoning summary" }]
          },
          {
            type: "model_output",
            content: [{ type: "text", text: "READY" }]
          }
        ]
      })
    ).toBe("READY");
  });

  it("parses interaction server-sent events", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: interaction.created\ndata: {"interaction":{"id":"int-1","status":"in_progress"},"event_type":"interaction.created"}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'event: step.delta\ndata: {"index":0,"delta":{"type":"text","text":"hello"},"event_type":"step.delta"}\n\n'
          )
        );
        controller.enqueue(encoder.encode("event: done\ndata: [DONE]\n\n"));
        controller.close();
      }
    });

    const events = [];
    for await (const event of readInteractionStream(stream)) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        event_type: "interaction.created",
        event_id: undefined,
        interaction: { id: "int-1", status: "in_progress" }
      },
      {
        event_type: "step.delta",
        event_id: undefined,
        index: 0,
        delta: { type: "text", text: "hello" }
      },
      {
        event_type: "done",
        event_id: undefined
      }
    ]);
  });

  it("streams interactions with stream=true", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'event: interaction.completed\ndata: {"interaction":{"id":"int-1","status":"completed","usage":{"total_tokens":12}},"event_type":"interaction.completed"}\n\n'
              )
            );
            controller.close();
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" }
        }
      )
    );
    const client = new GeminiManagedAgentsClient({
      apiKey: "test-key",
      fetch: fetchMock,
      timeoutMs: 1_000
    });

    const events = [];
    for await (const event of client.createInteractionStream({
      agent: "agent-lab-test",
      input: "hello",
      environment: "remote",
      store: true
    })) {
      events.push(event);
    }

    const [, init] = fetchMock.mock.calls[0] as Parameters<typeof fetch>;
    expect(JSON.parse(init?.body as string)).toMatchObject({
      agent: "agent-lab-test",
      input: "hello",
      environment: "remote",
      store: true,
      stream: true
    });
    expect(events[0].interaction?.usage?.total_tokens).toBe(12);
  });

  it("does not arm the default request timeout for foreground streams", async () => {
    vi.useFakeTimers();
    const outer = new AbortController();
    let fetchSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          fetchSignal = init?.signal as AbortSignal | undefined;
          fetchSignal?.addEventListener("abort", () => reject(fetchSignal?.reason), { once: true });
        })
    );
    const client = new GeminiManagedAgentsClient({
      apiKey: "test-key",
      fetch: fetchMock,
      timeoutMs: 1
    });

    const stream = (async () => {
      const events = [];
      for await (const event of client.createInteractionStream({
        agent: "agent-lab-test",
        input: "hello",
        environment: "remote",
        store: false
      }, { signal: outer.signal })) {
        events.push(event);
      }
      return events;
    })();

    try {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(10);
      expect(fetchSignal?.aborted).toBe(false);
      outer.abort(new Error("stream cancelled"));
      await expect(stream).rejects.toMatchObject({
        name: "GeminiApiConnectionError",
        details: expect.objectContaining({
          causeMessage: "stream cancelled"
        })
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("resumes a background interaction stream from the last event id", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'id: evt-4\nevent: interaction.completed\ndata: {"interaction":{"id":"int-1","status":"completed"},"event_type":"interaction.completed"}\n\n'
              )
            );
            controller.close();
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" }
        }
      )
    );
    const client = new GeminiManagedAgentsClient({
      apiKey: "test-key",
      fetch: fetchMock,
      timeoutMs: 1_000
    });

    const events = [];
    for await (const event of client.resumeInteractionStream("int-1", { lastEventId: "evt-3" })) {
      events.push(event);
    }

    const [url, init] = fetchMock.mock.calls[0] as Parameters<typeof fetch>;
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/interactions/int-1?stream=true&last_event_id=evt-3"
    );
    expect(init?.method).toBe("GET");
    expect(events[0].event_id).toBe("evt-4");
    expect(events[0].interaction?.status).toBe("completed");
  });

  it("cancels a server-side interaction", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ id: "int-1", status: "cancelled" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const client = new GeminiManagedAgentsClient({
      apiKey: "test-key",
      fetch: fetchMock,
      timeoutMs: 1_000
    });

    const interaction = await client.cancelInteraction("int-1");

    const [url, init] = fetchMock.mock.calls[0] as Parameters<typeof fetch>;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions/int-1/cancel");
    expect(init?.method).toBe("POST");
    expect(interaction.status).toBe("cancelled");
  });

  it("passes abort signals to environment snapshot downloads", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Promise<Response>((resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          controller.abort(new Error("snapshot cancelled"));
          resolve(new Response(new Uint8Array([1, 2, 3])));
        })
    );
    const client = new GeminiManagedAgentsClient({
      apiKey: "test-key",
      fetch: fetchMock,
      timeoutMs: 1_000
    });

    await expect(client.downloadEnvironmentSnapshot("env-test", { signal: controller.signal })).rejects.toMatchObject({
      name: "GeminiApiConnectionError",
      details: expect.objectContaining({
        method: "GET",
        causeMessage: "snapshot cancelled"
      })
    });
    const [, init] = fetchMock.mock.calls[0] as Parameters<typeof fetch>;
    expect((init?.signal as AbortSignal).aborted).toBe(true);
  });

  it("fails before network calls when the API key is missing", async () => {
    const fetchMock = vi.fn();
    const client = new GeminiManagedAgentsClient({
      apiKey: "",
      fetch: fetchMock,
      timeoutMs: 1_000
    });

    await expect(client.listAgents()).rejects.toBeInstanceOf(GeminiApiKeyMissingError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not read GEMINI_API_KEY from process.env", async () => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "ambient-key";
    try {
      const fetchMock = vi.fn();
      const client = new GeminiManagedAgentsClient({
        fetch: fetchMock,
        timeoutMs: 1_000
      });

      await expect(client.listAgents()).rejects.toBeInstanceOf(GeminiApiKeyMissingError);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = previous;
      }
    }
  });

  it("wraps transport failures with endpoint context", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    const client = new GeminiManagedAgentsClient({
      apiKey: "test-key",
      fetch: fetchMock,
      timeoutMs: 1_000
    });

    await expect(client.listAgents()).rejects.toMatchObject({
      name: "GeminiApiConnectionError",
      message: expect.stringContaining("GET https://generativelanguage.googleapis.com/v1beta/agents"),
      details: expect.objectContaining({
        method: "GET",
        url: "https://generativelanguage.googleapis.com/v1beta/agents",
        causeName: "TypeError",
        causeMessage: "fetch failed"
      })
    });
    await expect(client.listAgents()).rejects.toBeInstanceOf(GeminiApiConnectionError);
  });
});
