import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { PersistedSession } from "../src/shared/electron-api";
import { loadChatSessionsFromDisk, saveChatSessionsToDisk } from "../src/main/chatStore";

const session = (overrides: Partial<PersistedSession> & { localId: string; startedAt: number }): PersistedSession => ({
  agentId: "gemini-anything-agent",
  agentSnapshot: {
    id: "gemini-anything-agent",
    base_agent: "antigravity-preview-05-2026"
  },
  request: {
    agent: "gemini-anything-agent",
    input: "Create a cozy cat image",
    environment: "remote",
    store: true,
    background: true
  },
  seed: {
    id: `int-${overrides.localId}`,
    status: "completed",
    environment_id: "env-1"
  },
  completedAt: overrides.startedAt + 1000,
  ...overrides
});

describe("chat store", () => {
  it("writes one readable folder per conversation and reloads the sessions", () => {
    const root = mkdtempSync(join(tmpdir(), "gai-chat-store-"));
    try {
      const first = session({ localId: "root", startedAt: Date.UTC(2026, 5, 30, 12, 0, 0) });
      const second = session({
        localId: "followup",
        parentLocalId: "root",
        startedAt: Date.UTC(2026, 5, 30, 12, 1, 0),
        request: {
          agent: "gemini-anything-agent",
          input: "Turn that into an MP3",
          environment: "env-1",
          previous_interaction_id: "int-root",
          store: true,
          background: true
        },
        events: [{ event_type: "interaction.created", event_id: "evt-1" }]
      });

      saveChatSessionsToDisk(root, [second, first]);

      const [folder] = readdirSync(root);
      expect(folder).toContain("create-a-cozy-cat-image");
      expect(existsSync(join(root, folder, "conversation.json"))).toBe(true);
      expect(readFileSync(join(root, folder, "conversation.md"), "utf8")).toContain("Turn that into an MP3");
      expect(readdirSync(join(root, folder, "runs"))).toHaveLength(2);
      const runWithEvents = readdirSync(join(root, folder, "runs"))
        .map((run) => join(root, folder, "runs", run, "events.jsonl"))
        .find(existsSync);
      expect(runWithEvents ? readFileSync(runWithEvents, "utf8") : "").toContain("interaction.created");

      expect(loadChatSessionsFromDisk(root).map((item) => item.localId).sort()).toEqual(["followup", "root"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips rewriting conversations that have not changed", () => {
    const root = mkdtempSync(join(tmpdir(), "gai-chat-store-"));
    try {
      const first = session({ localId: "root", startedAt: Date.UTC(2026, 5, 30, 12, 0, 0) });
      saveChatSessionsToDisk(root, [first]);

      const [folder] = readdirSync(root);
      const markdownPath = join(root, folder, "conversation.md");
      writeFileSync(markdownPath, "SENTINEL", "utf8");

      saveChatSessionsToDisk(root, [first]);
      expect(readFileSync(markdownPath, "utf8")).toBe("SENTINEL");

      const second = session({
        localId: "followup",
        parentLocalId: "root",
        startedAt: Date.UTC(2026, 5, 30, 12, 1, 0)
      });
      saveChatSessionsToDisk(root, [first, second]);
      expect(readFileSync(markdownPath, "utf8")).not.toBe("SENTINEL");
      expect(readdirSync(join(root, folder, "runs"))).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes stale sidecar files when a run's error clears", () => {
    const root = mkdtempSync(join(tmpdir(), "gai-chat-store-"));
    try {
      const failed = session({
        localId: "root",
        startedAt: Date.UTC(2026, 5, 30, 12, 0, 0),
        error: { name: "StreamError", message: "boom" },
        events: [{ event_type: "interaction.created", event_id: "evt-1" }]
      });
      saveChatSessionsToDisk(root, [failed]);

      const [folder] = readdirSync(root);
      const [run] = readdirSync(join(root, folder, "runs"));
      const errorPath = join(root, folder, "runs", run, "error.json");
      const eventsPath = join(root, folder, "runs", run, "events.jsonl");
      expect(existsSync(errorPath)).toBe(true);
      expect(existsSync(eventsPath)).toBe(true);

      const { error: _error, events: _events, ...recovered } = failed;
      saveChatSessionsToDisk(root, [recovered as typeof failed]);
      expect(existsSync(errorPath)).toBe(false);
      expect(existsSync(eventsPath)).toBe(false);
      expect(existsSync(join(root, folder, "runs", run, "session.json"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes stale run folders when a conversation changes", () => {
    const root = mkdtempSync(join(tmpdir(), "gai-chat-store-"));
    try {
      const first = session({ localId: "root", startedAt: Date.UTC(2026, 5, 30, 12, 0, 0) });
      saveChatSessionsToDisk(root, [first]);

      const [folder] = readdirSync(root);
      const stalePath = join(root, folder, "runs", "20200101-000000-stale");
      mkdirSync(stalePath, { recursive: true });

      const second = session({
        localId: "followup",
        parentLocalId: "root",
        startedAt: Date.UTC(2026, 5, 30, 12, 1, 0)
      });
      saveChatSessionsToDisk(root, [first, second]);
      expect(existsSync(stalePath)).toBe(false);
      expect(readdirSync(join(root, folder, "runs"))).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes chat folders when conversations are deleted", () => {
    const root = mkdtempSync(join(tmpdir(), "gai-chat-store-"));
    try {
      saveChatSessionsToDisk(root, [session({ localId: "root", startedAt: 1 })]);
      expect(readdirSync(root)).toHaveLength(1);

      saveChatSessionsToDisk(root, []);
      expect(readdirSync(root)).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
