import { describe, expect, test } from "vitest";
import { AGENT_PROFILES, DEFAULT_AGENT_MODE, profileForMode, profileForSession } from "../src/agentProfiles";
import { BROWSER_AGENT_ID, CHAT_AGENT_ID, MODELS } from "../src/models";
import { OBJECT3D_AGENT_ID } from "../../shared/object3dProfile";

describe("agent profiles", () => {
  test("Antigravity is the default and custom profiles use valid stable ids", () => {
    expect(DEFAULT_AGENT_MODE).toBe("antigravity");
    expect(profileForMode(undefined).agentId).toBe(MODELS.chatAgentBase);
    expect(AGENT_PROFILES.anything.agentId).toBe(CHAT_AGENT_ID);
    expect(AGENT_PROFILES.browser.agentId).toBe(BROWSER_AGENT_ID);
    expect(AGENT_PROFILES.object3d.agentId).toBe(OBJECT3D_AGENT_ID);
    expect(AGENT_PROFILES.object3d.managed).toBe(true);
    expect(AGENT_PROFILES.object3d.object3dPersona).toBe(true);
    expect(CHAT_AGENT_ID.startsWith("gemini-")).toBe(false);
    expect(BROWSER_AGENT_ID.startsWith("gemini-")).toBe(false);
  });

  test("3D View stays stored and backgrounded while general chats retain explicit controls", async () => {
    const { effectiveRunOptions } = await import("../src/state/runOptions");
    const { DEFAULT_RUN_OPTIONS } = await import("../src/state/types");
    const runOptions = { ...DEFAULT_RUN_OPTIONS, store: false, background: false };
    expect(effectiveRunOptions({ agentMode: "object3d", runOptions })).toMatchObject({ store: true, background: true });
    expect(effectiveRunOptions({ agentMode: "anything", runOptions })).toMatchObject({ store: false, background: false });
  });
  test("both research levels are represented", () => {
    expect(AGENT_PROFILES["deep-research"].agentId).toBe(MODELS.deepResearch);
    expect(AGENT_PROFILES["deep-research-max"].agentId).toBe(MODELS.deepResearchMax);
  });

  test("profileForSession resolves every session shape the same way at every call site", () => {
    expect(profileForSession({ agentMode: "browser" }).mode).toBe("browser");
    // Legacy pre-agentMode research session.
    expect(profileForSession({ mode: "deep-research" }).mode).toBe("deep-research");
    // Legacy pre-agentMode chat session.
    expect(profileForSession({ mode: "chat" }).mode).toBe(DEFAULT_AGENT_MODE);
    expect(profileForSession({}).mode).toBe(DEFAULT_AGENT_MODE);
  });
});
