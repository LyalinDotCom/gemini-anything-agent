import { describe, expect, it } from "vitest";
import { buildAgent, buildInteraction } from "../src/renderer/lib/payload";
import { computeCardState, type CapabilityKey } from "../src/renderer/lib/badges";
import { agentToDraft } from "../src/renderer/lib/agentToDraft";
import { nextAgentVersionId } from "../src/renderer/lib/versioning";
import {
  initialCompose,
  minimalBuilder,
  newAssetFile,
  newEnvFile,
  uniqueEnvName,
  type Session,
  type BuilderDraft
} from "../src/renderer/lib/builderState";
import {
  localProjectPath,
  projectFileIssues,
  projectFilesForSave
} from "../src/renderer/lib/projectFiles";
import { skillLibrary, skillTemplateToProjectFile } from "../src/renderer/lib/skillLibrary";
import {
  renameSessionsForAgent,
  removeSessionsForAgent,
  sanitizeSessionHistory
} from "../src/renderer/lib/sessionStore";
import {
  NEW_CONVERSATION_ID,
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
import {
  extractMediaPaths,
  extractWorkspaceOutputPaths,
  mediaPathMatches,
  mentionsWorkspaceOutput,
  shouldAutoResolveMedia
} from "../src/renderer/lib/mediaResolver";
import { outputFileLabel, outputFileMatchesPath, outputFilesCoverPaths } from "../src/renderer/lib/outputFiles";
import { buildChatInteraction, composeFromRequest } from "../src/renderer/lib/interactionInput";
import { DEEP_RESEARCH_AGENT, DEEP_RESEARCH_MAX_AGENT } from "../src/sdk";

const KEY_FOR: Partial<Record<CapabilityKey, string>> = {
  brain: "system_instruction",
  tools: "tools",
  environment: "base_environment"
};

describe("renderer payload compiler", () => {
  it("a starter agent emits AGENTS.md as a project source", () => {
    const agent = buildAgent(minimalBuilder());
    expect(Object.keys(agent).sort()).toEqual(["base_agent", "base_environment", "id"]);
    expect(
      typeof agent.base_environment === "object" &&
        agent.base_environment.sources?.some(
          (source) => source.type === "inline" && source.target === ".agents/AGENTS.md"
        )
    ).toBe(true);
  });

  it("a bare draft with no project files emits only the required keys", () => {
    const agent = buildAgent({ ...minimalBuilder(), projectFiles: [] });
    expect(Object.keys(agent).sort()).toEqual(["base_agent", "id"]);
  });

  it("bakes the active .env into the sandbox root and treats it as plain text", () => {
    const envFile = { ...newEnvFile(), content: "GITHUB_TOKEN=secret\n# free-form text is fine" };
    const agent = buildAgent({
      ...minimalBuilder(),
      projectFiles: [envFile],
      activeEnvFileId: envFile.id
    });

    expect(localProjectPath(envFile, envFile.id)).toBe(".env");
    expect(
      typeof agent.base_environment === "object" &&
        agent.base_environment.sources?.some(
          (source) =>
            source.type === "inline" &&
            source.target === ".env" &&
            source.content === "GITHUB_TOKEN=secret\n# free-form text is fine"
        )
    ).toBe(true);
  });

  it("only sends the active .env; inactive named .env files stay a local library", () => {
    const active = { ...newEnvFile(".env"), content: "ACTIVE=1" };
    const staging = { ...newEnvFile(".env.staging"), content: "STAGING=1" };
    const draft = {
      ...minimalBuilder(),
      projectFiles: [active, staging],
      activeEnvFileId: active.id
    };

    // Inactive .env persists locally under env/, active maps to the sandbox root.
    expect(localProjectPath(active, active.id)).toBe(".env");
    expect(localProjectPath(staging, active.id)).toBe("env/.env.staging");

    const saved = projectFilesForSave(draft.projectFiles, active.id).map((file) => file.path);
    expect(saved).toContain(".env");
    expect(saved).toContain("env/.env.staging");

    const agent = buildAgent(draft);
    const envTargets =
      typeof agent.base_environment === "object"
        ? (agent.base_environment.sources ?? [])
            .filter((source) => source.target === ".env")
            .map((source) => source.type === "inline" && source.content)
        : [];
    // Exactly one .env source, and it is the active one.
    expect(envTargets).toEqual(["ACTIVE=1"]);
  });

  it("names new .env files uniquely", () => {
    const first = newEnvFile(uniqueEnvName([]));
    expect(first.name).toBe(".env");
    expect(uniqueEnvName([first])).toBe(".env.2");
    expect(uniqueEnvName([first, { ...newEnvFile(".env.2") }])).toBe(".env.3");
  });

  it("installs the GitHub repo sync skill from the library", () => {
    const skill = skillLibrary.find((item) => item.id === "github-repo-sync");
    expect(skill).toBeDefined();

    const file = skillTemplateToProjectFile(skill!);
    expect(file.name).toBe("github-repo-sync");
    expect(file.target).toBe(".agents/github-repo-sync/SKILL.md");
    expect(file.content).toContain("GITHUB_TOKEN");
    expect(file.content).toContain("git push -u origin HEAD");
  });

  it("allows temporarily empty editable file names but reports them as invalid", () => {
    const clearedAsset = {
      ...newAssetFile("notes.md"),
      name: "",
      target: "assets/",
      content: "data"
    };

    expect(projectFileIssues([clearedAsset])).toEqual(["Asset file name is required."]);
    expect(projectFilesForSave([clearedAsset])).toEqual([]);
  });

  it("enforces the Badge==Key invariant across capabilities", () => {
    const drafts: BuilderDraft[] = [
      minimalBuilder(),
      { ...minimalBuilder(), systemInstruction: "Be careful." },
      { ...minimalBuilder(), toolMode: "custom" },
      { ...minimalBuilder(), environmentMode: "environment_id", environmentId: "env-123" },
      {
        ...minimalBuilder(),
        environmentMode: "config",
        sources: [
          { id: "a", type: "inline", source: "", target: ".agents/AGENTS.md", content: "hi" }
        ]
      }
    ];

    for (const draft of drafts) {
      const agent = buildAgent(draft) as Record<string, unknown>;
      for (const key of ["brain", "tools", "environment"] as CapabilityKey[]) {
        const descriptor = computeCardState(draft, key);
        const present = Boolean(KEY_FOR[key] && KEY_FOR[key]! in agent);
        expect(present).toBe(descriptor.emitsKey);
        expect(descriptor.state === "custom").toBe(present);
      }
    }
  });

  it("omits base_environment for a bare fresh-remote sandbox", () => {
    const agent = buildAgent({ ...minimalBuilder(), projectFiles: [] }) as Record<string, unknown>;
    expect("base_environment" in agent).toBe(false);
  });

  it("treats custom tools with nothing selected as Default (no tools key emitted)", () => {
    const draft: BuilderDraft = {
      ...minimalBuilder(),
      toolMode: "custom",
      selectedTools: { code_execution: false, google_search: false, url_context: false }
    };
    const agent = buildAgent(draft) as Record<string, unknown>;
    expect("tools" in agent).toBe(false);
    expect(computeCardState(draft, "tools").state).toBe("default");
    expect(computeCardState(draft, "tools").emitsKey).toBe(false);
  });

  it("treats an allowlist with no valid rules as Default (no network key emitted)", () => {
    const draft: BuilderDraft = {
      ...minimalBuilder(),
      environmentMode: "config",
      networkMode: "allowlist",
      networkRules: []
    };
    const env = (buildAgent(draft) as Record<string, unknown>).base_environment as
      | Record<string, unknown>
      | undefined;
    expect(env && "network" in env).toBeFalsy();
    expect(computeCardState(draft, "network").emitsKey).toBe(false);
  });

  it("sends normal text as a plain interaction input", () => {
    const request = buildInteraction(minimalBuilder(), {
      ...initialCompose,
      input: "hello",
      parts: []
    });
    expect(request.input).toBe("hello");
  });

  it("sends a fresh remote environment for default interactions", () => {
    const request = buildInteraction(minimalBuilder(), initialCompose);
    expect(request.environment).toBe("remote");
    expect(request.input).toBe("");
    expect(request.store).toBe(true);
    expect(request.background).toBe(true);
  });

  it("only sends background execution when stored history is on", () => {
    const stored = buildInteraction(minimalBuilder(), {
      ...initialCompose,
      store: true,
      background: true
    });
    const unstored = buildInteraction(minimalBuilder(), {
      ...initialCompose,
      store: false,
      background: true
    });

    expect(stored.background).toBe(true);
    expect(unstored.background).toBeUndefined();
  });

  it("emits optional run quality controls when changed", () => {
    const request = buildInteraction(minimalBuilder(), {
      ...initialCompose,
      serviceTier: "priority",
      thinkingSummaries: "auto"
    });

    expect(request.service_tier).toBe("priority");
    expect(request.agent_config).toEqual({
      type: "dynamic",
      thinking_summaries: "auto"
    });
  });

  it("round-trips a built agent back into an editable draft", () => {
    const draft: BuilderDraft = {
      ...minimalBuilder(),
      id: "round-trip",
      systemInstruction: "Stay concise.",
      toolMode: "custom",
      selectedTools: { code_execution: true, google_search: false, url_context: true },
      environmentMode: "environment_id",
      environmentId: "env-xyz"
    };
    const back = agentToDraft(buildAgent(draft));
    expect(back.id).toBe("round-trip");
    expect(back.systemInstruction).toBe("Stay concise.");
    expect(back.toolMode).toBe("custom");
    expect(back.selectedTools).toEqual({
      code_execution: true,
      google_search: false,
      url_context: true
    });
    expect(back.environmentMode).toBe("environment_id");
    expect(back.environmentId).toBe("env-xyz");
  });

  it("round-trips inline project files back into the project editor", () => {
    const back = agentToDraft({
      id: "project-agent",
      base_agent: "antigravity-preview-05-2026",
      base_environment: {
        type: "remote",
        sources: [
          { type: "inline", target: ".agents/AGENTS.md", content: "agent rules" },
          { type: "inline", target: ".env", content: "GITHUB_TOKEN=secret" },
          { type: "inline", target: ".agents/github-repo-sync/SKILL.md", content: "# GitHub Repo Sync" },
          { type: "repository", source: "https://github.com/example/repo.git", target: "repo" }
        ]
      }
    });

    expect(back.projectFiles.map((file) => [file.kind, file.target])).toEqual([
      ["instructions", ".agents/AGENTS.md"],
      ["env", ".env"],
      ["skill", ".agents/github-repo-sync/SKILL.md"]
    ]);
    expect(back.sources).toHaveLength(1);
    expect(back.sources[0].type).toBe("repository");
  });

  it("builds a multimodal interaction request with attached images", () => {
    const draft = minimalBuilder();
    const request = buildInteraction(draft, {
      ...initialCompose,
      input: "Describe this",
      parts: [
        { id: "i", kind: "image", data: "AAAA", mimeType: "image/png", name: "x.png", bytes: 3 }
      ]
    });
    expect(request.agent).toBe(draft.id);
    expect(Array.isArray(request.input)).toBe(true);
    expect(request.input).toEqual([
      { type: "text", text: "Describe this" },
      { type: "image", data: "AAAA", mime_type: "image/png" }
    ]);
  });

  it("builds a Deep Research request invoked by base-agent id", () => {
    const request = buildChatInteraction("gemini-anything-agent", {
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
    const request = buildChatInteraction("gemini-anything-agent", {
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
      agent: "gemini-anything-agent",
      input: "Do something.",
      environment: "remote"
    });

    expect(research.agentMode).toBe("deep-research");
    expect(anything.agentMode).toBe("anything");
  });

  it("chooses the next available agent version id", () => {
    expect(
      nextAgentVersionId("my-first-agent", [
        { id: "my-first-agent" },
        { id: "my-first-agent-v2" }
      ])
    ).toBe("my-first-agent-v3");
    expect(nextAgentVersionId("my-first-agent-v2", [{ id: "my-first-agent" }])).toBe("my-first-agent-v2");
    expect(nextAgentVersionId("  ", [])).toBe("my-first-agent");
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
    expect(renamed[0].request.agent).toBe("agent-a");
  });
});

describe("renderer media resolver", () => {
  const mediaSession = (input: string): Session => ({
    localId: "media-session",
    agentId: "agent-a",
    agentSnapshot: {
      id: "agent-a",
      base_agent: "antigravity-preview-05-2026"
    },
    request: {
      agent: "agent-a",
      environment: "remote",
      input
    },
    startedAt: 1
  });

  it("extracts unique generated media paths and trims surrounding punctuation", () => {
    expect(
      extractMediaPaths(
        "Saved `/workspace/output/cat.png`, also /workspace/output/cat.png. Video: workspace/output/clip.mp4?download=1"
      )
    ).toEqual(["/workspace/output/cat.png", "workspace/output/clip.mp4"]);
  });

  it("canonicalizes autosaved managed-agent media paths back to workspace output paths", () => {
    expect(
      extractMediaPaths(
        [
          "/workspace/output/welcome.wav",
          "Saved locally: /Users/me/project/outputs/managed-agent/env-123/welcome.wav",
          "Also outputs/managed-agent/env-123/nested/cat.png."
        ].join("\n")
      )
    ).toEqual(["/workspace/output/welcome.wav", "/workspace/output/nested/cat.png"]);
  });

  it("extracts any workspace output path for output-folder refreshes", () => {
    const text = [
      "Created Image: /workspace/output/cozy_cat_string.jpg",
      "Created HTML: workspace/output/solar-system.html.",
      "Saved locally: /Users/me/project/outputs/managed-agent/env-123/transcripts/episode.md"
    ].join("\n");

    expect(extractWorkspaceOutputPaths(text)).toEqual([
      "/workspace/output/cozy_cat_string.jpg",
      "workspace/output/solar-system.html",
      "/workspace/output/transcripts/episode.md"
    ]);
    expect(mentionsWorkspaceOutput(text)).toBe(true);
  });

  it("does not auto-download media for transcript-only requests", () => {
    expect(shouldAutoResolveMedia(mediaSession("transcribe this audio file with timestamps"))).toBe(false);
    expect(shouldAutoResolveMedia(mediaSession("make a podcast and transcribe it"))).toBe(true);
    expect(shouldAutoResolveMedia(mediaSession("generate an image of a cat"))).toBe(true);
  });

  it("matches sandbox, cache, and saved media paths for one artifact", () => {
    const item = {
      requestedPath: "/workspace/output/cat.png",
      path: "/cache/environment/workspace/output/cat.png",
      savedPath: "/local/outputs/cat.png",
      url: "gemini-media://env/workspace/output/cat.png",
      mediaType: "image" as const
    };

    expect(mediaPathMatches(item, "workspace/output/cat.png")).toBe(true);
    expect(mediaPathMatches(item, "/local/outputs/cat.png")).toBe(true);
    expect(mediaPathMatches(item, "/Users/me/project/outputs/managed-agent/env-123/cat.png")).toBe(true);
    expect(mediaPathMatches(item, "/workspace/output/dog.png")).toBe(false);
  });

  it("checks whether cached output files cover claimed workspace paths", () => {
    const files = [
      {
        sandboxPath: "/workspace/output/cozy_cat_string.jpg",
        relativePath: "cozy_cat_string.jpg",
        name: "cozy_cat_string.jpg",
        path: "/cache/environment/workspace/output/cozy_cat_string.jpg",
        bytes: 123,
        modifiedAt: 1,
        fileType: "image" as const,
        mediaType: "image" as const,
        url: "gemini-media://env/workspace/output/cozy_cat_string.jpg"
      }
    ];

    expect(outputFileMatchesPath(files[0], "workspace/output/cozy_cat_string.jpg")).toBe(true);
    expect(outputFilesCoverPaths(files, ["/workspace/output/cozy_cat_string.jpg"])).toBe(true);
    expect(outputFilesCoverPaths(files, ["/workspace/output/missing.jpg"])).toBe(false);
  });

  it("labels markdown output files distinctly from plain text", () => {
    expect(outputFileLabel({
      sandboxPath: "/workspace/output/transcript.md",
      relativePath: "transcript.md",
      name: "transcript.md",
      path: "/cache/environment/workspace/output/transcript.md",
      bytes: 123,
      modifiedAt: 1,
      fileType: "markdown",
      url: "gemini-media://env/workspace/output/transcript.md"
    })).toBe("Markdown");
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
