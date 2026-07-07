import { describe, expect, it } from "vitest";
import type { Session } from "../src/renderer/lib/builderState";
import {
  latestContinuableSession,
  latestReusableEnvironmentSession,
  withAutoContinuity
} from "../src/renderer/lib/continuity";

const session = (
  overrides: Partial<Session> & {
    localId: string;
    startedAt: number;
  }
): Session => ({
  agentId: "gemini-anything-v1",
  agentSnapshot: {
    id: "gemini-anything-v1",
    base_agent: "antigravity-preview-05-2026"
  },
  request: {
    agent: "gemini-anything-v1",
    input: "make something",
    environment: "remote",
    store: true
  },
  seed: {
    id: `int-${overrides.localId}`,
    status: "completed",
    environment_id: `env-${overrides.localId}`
  },
  ...overrides
});

describe("conversation continuity", () => {
  it("only continues from completed successful turns", () => {
    const complete = session({ localId: "complete", startedAt: 1 });
    const running = session({
      localId: "running",
      startedAt: 2,
      seed: { id: "int-running", status: "in_progress", environment_id: "env-running" }
    });
    const failed = session({
      localId: "failed",
      startedAt: 3,
      error: { name: "GeminiApiError", message: "Precondition check failed." }
    });
    const serverFailed = session({
      localId: "server-failed",
      startedAt: 4,
      seed: { id: "int-server-failed", status: "failed", environment_id: "env-server-failed" }
    });

    expect(latestContinuableSession([complete, running, failed, serverFailed], "gemini-anything-v1")?.localId)
      .toBe("complete");
    expect(latestReusableEnvironmentSession([complete, running, failed, serverFailed], "gemini-anything-v1")?.localId)
      .toBe("complete");
  });

  it("uses one latest successful turn for both previous_interaction_id and environment", () => {
    const earlier = session({ localId: "earlier", startedAt: 1 });
    const latest = session({ localId: "latest", startedAt: 2 });

    const request = withAutoContinuity(
      {
        agent: "gemini-anything-v1",
        input: "fix it",
        environment: "remote",
        store: true
      },
      [earlier, latest],
      {
        autoContinue: true,
        reuseEnvironment: true
      }
    );

    expect(request.previous_interaction_id).toBe("int-latest");
    expect(request.environment).toBe("env-latest");
  });

  it("can reuse only the environment when the latest successful turn was not stored", () => {
    const latest = session({
      localId: "latest",
      startedAt: 2,
      request: {
        agent: "gemini-anything-v1",
        input: "make something",
        environment: "remote",
        store: false
      }
    });

    const request = withAutoContinuity(
      {
        agent: "gemini-anything-v1",
        input: "inspect the files",
        environment: "remote",
        store: true
      },
      [latest],
      {
        autoContinue: true,
        reuseEnvironment: true
      }
    );

    expect(request.previous_interaction_id).toBeUndefined();
    expect(request.environment).toBe("env-latest");
  });
});
