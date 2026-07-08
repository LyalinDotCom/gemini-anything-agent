import { describe, expect, it } from "vitest";
import { initialCompose, type Session } from "../src/renderer/lib/builderState";
import {
  renameSessionsForAgent,
  removeSessionsForAgent,
  sanitizeSessionHistory
} from "../src/renderer/lib/sessionStore";
import {
  applyManualConversationOrder,
  NEW_CONVERSATION_ID,
  reorderConversationIds,
  visibleConversationsWithDraft,
  type ConversationSummary
} from "../src/renderer/lib/conversations";
import {
  latestContinuableSession,
  latestReusableEnvironmentSession,
  sessionEnvironmentId,
  withAutoContinuation,
  withAutoEnvironment
} from "../src/renderer/lib/continuity";
import { outputFileLabel, outputFileMatchesPath, outputFilesCoverPaths } from "../src/renderer/lib/outputFiles";
import { buildChatInteraction, composeFromRequest } from "../src/renderer/lib/interactionInput";
import { ANTIGRAVITY_BASE_AGENT, DEEP_RESEARCH_AGENT, DEEP_RESEARCH_MAX_AGENT } from "../src/sdk";

describe("chat interaction builder", () => {
  it("builds a multimodal request with attached images", () => {
    const request = buildChatInteraction("gemini-anything-v1", {
      ...initialCompose,
      input: "Describe this",
      parts: [
        { id: "i", kind: "image", data: "AAAA", mimeType: "image/png", name: "x.png", bytes: 3 }
      ]
    });
    expect(request.agent).toBe("gemini-anything-v1");
    expect(request.input).toEqual([
      { type: "text", text: "Describe this" },
      { type: "image", data: "AAAA", mime_type: "image/png" }
    ]);
  });

  it("routes plain Antigravity chats directly to the base agent", () => {
    const request = buildChatInteraction("gemini-anything-v1", {
      ...initialCompose,
      specializedToolsEnabled: false,
      input: "Try this without the Gemini Anything payload."
    });

    expect(request.agent).toBe(ANTIGRAVITY_BASE_AGENT);
    expect(request.environment).toBe("remote");
    expect(request.tools).toEqual([{ type: "code_execution" }, { type: "google_search" }, { type: "url_context" }]);
  });

  it("builds a Deep Research request invoked by base-agent id", () => {
    const request = buildChatInteraction("gemini-anything-v1", {
      ...initialCompose,
      agentMode: "deep-research",
      input: "Research the history of Google TPUs.",
      // These overrides do not apply to Deep Research and must be ignored.
      store: false,
      background: false,
      overrideSystemInstruction: true,
      systemInstruction: "ignored",
      overrideTools: true,
      overrideEnvironment: true,
      environmentId: "env-ignored"
    });

    expect(request.agent).toBe(DEEP_RESEARCH_AGENT);
    expect(request.store).toBe(true);
    expect(request.background).toBe(true);
    expect(request.environment).toBe("remote");
    expect(request.agent_config).toEqual({ type: "deep-research" });
    expect(request.system_instruction).toBeUndefined();
    expect(request.tools).toBeUndefined();
  });

  it("keeps Deep Research follow-ups chained to the previous interaction", () => {
    const request = buildChatInteraction("gemini-anything-v1", {
      ...initialCompose,
      agentMode: "deep-research-max",
      input: "Expand the report with a competitor table.",
      previousInteractionId: "int-research-1",
      thinkingSummaries: "auto"
    });

    expect(request.agent).toBe(DEEP_RESEARCH_MAX_AGENT);
    expect(request.previous_interaction_id).toBe("int-research-1");
    expect(request.agent_config).toEqual({
      type: "deep-research",
      thinking_summaries: "auto"
    });
  });

  it("restores the agent mode when rebuilding compose state from a request", () => {
    const research = composeFromRequest({
      agent: DEEP_RESEARCH_AGENT,
      input: "Research something.",
      environment: "remote",
      store: true,
      background: true
    });
    const anything = composeFromRequest({
      agent: "gemini-anything-v1",
      input: "Do something.",
      environment: "remote"
    });
    const plain = composeFromRequest({
      agent: ANTIGRAVITY_BASE_AGENT,
      input: "Do something plainly.",
      environment: "remote"
    });

    expect(research.agentMode).toBe("deep-research");
    expect(anything.agentMode).toBe("anything");
    expect(anything.specializedToolsEnabled).toBe(true);
    expect(plain.agentMode).toBe("anything");
    expect(plain.specializedToolsEnabled).toBe(false);
  });
});

describe("manual conversation ordering", () => {
  const conversation = (id: string): ConversationSummary => ({
    id,
    title: id,
    sessions: [],
    latestAt: 0
  });

  it("keeps recency order until the user has dragged something", () => {
    const list = [conversation("a"), conversation("b")];
    expect(applyManualConversationOrder(list, [])).toEqual(list);
  });

  it("applies the manual order and floats unknown (new) conversations to the top", () => {
    const list = [conversation("new"), conversation("a"), conversation("b")];
    const ordered = applyManualConversationOrder(list, ["b", "a"]);
    expect(ordered.map((item) => item.id)).toEqual(["new", "b", "a"]);
  });

  it("ignores manually ordered ids that no longer exist", () => {
    const list = [conversation("a")];
    const ordered = applyManualConversationOrder(list, ["deleted", "a"]);
    expect(ordered.map((item) => item.id)).toEqual(["a"]);
  });

  it("moves a dragged conversation into the drop slot", () => {
    expect(reorderConversationIds(["a", "b", "c"], "a", 3)).toEqual(["b", "c", "a"]);
    expect(reorderConversationIds(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(reorderConversationIds(["a", "b", "c"], "b", 1)).toEqual(["a", "b", "c"]);
    expect(reorderConversationIds(["a", "b", "c"], "a", 2)).toEqual(["b", "a", "c"]);
    expect(reorderConversationIds(["a", "b", "c"], "missing", 0)).toEqual(["a", "b", "c"]);
  });
});

describe("conversation list drafts", () => {
  const savedConversation = (id: string): ConversationSummary => ({
    id,
    title: `Saved ${id}`,
    sessions: [],
    latestAt: Date.now()
  });

  it("keeps a created new-chat draft visible after switching away from it", () => {
    const visible = visibleConversationsWithDraft({
      activeConversationId: "saved-1",
      conversations: [savedConversation("saved-1")],
      draftVisible: true,
      startingConversationIds: {}
    });

    expect(visible.map((conversation) => conversation.id)).toEqual([NEW_CONVERSATION_ID, "saved-1"]);
    expect(visible[0].draft).toBe(true);
  });

  it("does not recreate a consumed new-chat draft until the app asks for one", () => {
    const visible = visibleConversationsWithDraft({
      activeConversationId: "run-1",
      conversations: [savedConversation("run-1")],
      draftVisible: false,
      startingConversationIds: {}
    });

    expect(visible.map((conversation) => conversation.id)).toEqual(["run-1"]);
  });
});

describe("session history storage", () => {
  const session = (agentId: string, startedAt: number, localId = `${agentId}-${startedAt}`): Session => ({
    localId,
    agentId,
    agentSnapshot: {
      id: agentId,
      base_agent: "antigravity-preview-05-2026",
      system_instruction: "Historic saved instruction",
      tools: [{ type: "code_execution" }]
    },
    request: {
      agent: agentId,
      environment: "remote",
      input: "Inspect the workspace"
    },
    seed: {
      id: `int-${localId}`,
      status: "completed"
    },
    startedAt
  });

  it("loads valid stored runs newest first", () => {
    expect(sanitizeSessionHistory([session("agent-a", 1), session("agent-a", 3), session("agent-a", 2)])
      .map((item) => item.startedAt)).toEqual([3, 2, 1]);
  });

  it("drops malformed stored run records", () => {
    expect(
      sanitizeSessionHistory([
        session("agent-a", 1),
        { localId: "bad", agentId: "agent-a", startedAt: 2 },
        { localId: "bad-date", agentId: "agent-a", request: session("agent-a", 3).request, startedAt: Number.NaN },
        null
      ])
    ).toHaveLength(1);
  });

  it("round-trips run history through storage", () => {
    const [stored] = sanitizeSessionHistory([
      {
        ...session("agent-a", 1),
        completedAt: 1201,
        imageAttachments: [{ id: "img-1", name: "cat.png", bytes: 42, mimeType: "image/png", path: "/tmp/cat.png" }]
      }
    ]);
    expect(stored.agentId).toBe("agent-a");
    expect(stored.agentSnapshot?.system_instruction).toBe("Historic saved instruction");
    expect(stored.completedAt).toBe(1201);
    expect(stored.imageAttachments?.[0].name).toBe("cat.png");
    expect(stored.imageAttachments?.[0].path).toBe("/tmp/cat.png");
  });

  it("redacts secret-looking .env values from stored agent snapshots", () => {
    const [stored] = sanitizeSessionHistory([
      {
        ...session("agent-a", 1),
        agentSnapshot: {
          id: "agent-a",
          base_agent: "antigravity-preview-05-2026",
          base_environment: {
            type: "remote",
            sources: [
              {
                type: "inline",
                target: ".env",
                content: "GEMINI_API_KEY=real-key\nGEMINI_ANYTHING_NPM_VERSION=latest\n"
              }
            ]
          }
        }
      }
    ]);

    expect(JSON.stringify(stored)).not.toContain("real-key");
    const sources =
      typeof stored.agentSnapshot?.base_environment === "object"
        ? stored.agentSnapshot.base_environment.sources ?? []
        : [];
    const envSource = sources.find((source) => source.type === "inline" && source.target === ".env");
    expect(envSource?.type === "inline" ? envSource.content : "").toContain("GEMINI_API_KEY=<configured>");
    expect(envSource?.type === "inline" ? envSource.content : "").toContain("GEMINI_ANYTHING_NPM_VERSION=latest");
  });

  it("drops stored runs without an agent snapshot", () => {
    const [stored] = sanitizeSessionHistory([{ ...session("agent-a", 1), agentSnapshot: undefined }]);
    expect(stored).toBeUndefined();
  });

  it("preserves streamed events in stored run history", () => {
    const [stored] = sanitizeSessionHistory([
      {
        ...session("agent-a", 1),
        events: [
          { event_type: "interaction.created", event_id: "evt-1", interaction: { id: "int-a", status: "in_progress" } },
          { event_type: "step.delta", index: 0, delta: { type: "text", text: "ready" } }
        ],
        streaming: true,
        streamId: "local-stream"
      }
    ]);

    expect(stored.streaming).toBe(false);
    expect(stored.streamId).toBeUndefined();
    expect(stored.events?.map((event) => event.event_type)).toEqual([
      "interaction.created",
      "step.delta"
    ]);
    expect(stored.events?.[0].event_id).toBe("evt-1");
  });

  it("removes all run history for a deleted agent", () => {
    expect(removeSessionsForAgent([session("agent-a", 1), session("agent-b", 2)], "agent-a")
      .map((item) => item.agentId)).toEqual(["agent-b"]);
  });

  it("moves local run history when an agent is renamed", () => {
    const renamed = renameSessionsForAgent(
      [session("agent-a", 1), session("agent-b", 2)],
      "agent-a",
      "agent-c"
    );

    expect(renamed.map((item) => item.agentId)).toEqual(["agent-c", "agent-b"]);
    expect(renamed[0].request.agent).toBe("agent-c");
    expect(renamed[0].agentSnapshot?.id).toBe("agent-c");
  });
});

describe("stored interaction continuity", () => {
  const session = (
    agentId: string,
    startedAt: number,
    interactionId: string,
    options: Partial<Session> = {}
  ): Session => ({
    localId: `${agentId}-${startedAt}`,
    agentId,
    agentSnapshot: {
      id: agentId,
      base_agent: "antigravity-preview-05-2026"
    },
    request: {
      agent: agentId,
      environment: "remote",
      input: "Inspect the workspace",
      store: true
    },
    seed: {
      id: interactionId,
      environment_id: `env-${interactionId}`,
      status: "completed"
    },
    startedAt,
    ...options
  });

  it("continues from the newest stored interaction for the same agent", () => {
    const sessions = [
      session("agent-a", 1, "old"),
      session("agent-b", 3, "wrong-agent"),
      session("agent-a", 2, "newest")
    ];
    const request = withAutoContinuation(
      { agent: "agent-a", environment: "remote", input: "Again", store: true },
      sessions,
      true
    );

    expect(latestContinuableSession(sessions, "agent-a")?.seed?.id).toBe("newest");
    expect(request.previous_interaction_id).toBe("newest");
  });

  it("does not auto-continue explicit, fresh, failed, or unstored runs", () => {
    const sessions = [
      session("agent-a", 4, "failed", { error: { name: "Error", message: "Nope" } }),
      session("agent-a", 3, "unstored", {
        request: { agent: "agent-a", environment: "remote", input: "Fresh", store: false }
      }),
      session("agent-a", 2, "usable")
    ];

    expect(
      withAutoContinuation(
        { agent: "agent-a", environment: "remote", input: "Again", store: true, previous_interaction_id: "manual" },
        sessions,
        true
      ).previous_interaction_id
    ).toBe("manual");
    expect(
      withAutoContinuation(
        { agent: "agent-a", environment: "remote", input: "Again", store: false },
        sessions,
        true
      ).previous_interaction_id
    ).toBeUndefined();
    expect(
      withAutoContinuation(
        { agent: "agent-a", environment: "remote", input: "Again", store: true },
        sessions,
        false
      ).previous_interaction_id
    ).toBeUndefined();
    expect(latestContinuableSession(sessions, "agent-a")?.seed?.id).toBe("usable");
  });

  it("reuses the newest finished environment only when the switch is on", () => {
    const sessions = [
      session("agent-a", 1, "old"),
      session("agent-b", 3, "wrong-agent"),
      session("agent-a", 4, "failed", { error: { name: "Error", message: "Nope" } }),
      session("agent-a", 2, "newest")
    ];

    expect(sessionEnvironmentId(latestReusableEnvironmentSession(sessions, "agent-a")!)).toBe("env-newest");
    expect(
      withAutoEnvironment(
        { agent: "agent-a", environment: "remote", input: "Again", store: true },
        sessions,
        true
      ).environment
    ).toBe("env-newest");
    expect(
      withAutoEnvironment(
        { agent: "agent-a", environment: "remote", input: "Again", store: true },
        sessions,
        false
      ).environment
    ).toBe("remote");
    expect(
      withAutoEnvironment(
        { agent: "agent-a", environment: "env-manual", input: "Again", store: true },
        sessions,
        true
      ).environment
    ).toBe("env-manual");
  });
});
