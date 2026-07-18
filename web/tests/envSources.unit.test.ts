import { describe, expect, test } from "vitest";
import { buildEnvSources, payloadFingerprint } from "../src/gemini/envSources";

describe("shared managed-agent payload", () => {
  test("mounts the media and headless-browser capabilities", () => {
    const sources = buildEnvSources("test-key");
    const byTarget = new Map(sources.map((source) => [source.target, source.content]));

    expect(byTarget.get("/.agents/AGENTS.md")).toContain("Headless browser wrapper");
    expect(byTarget.get("/.agents/bin/gai")).toContain("@lyalindotcom/gai");
    expect(byTarget.get("/.agents/bin/browser")).toContain("@playwright/cli");
    expect(byTarget.get("/.agents/skills/gemini-anything/SKILL.md")).toContain("Gemini Anything Media Skill");
    expect(byTarget.get("/.agents/skills/browser-testing/SKILL.md")).toContain("Browser Testing Skill");
  });

  test("fingerprint changes with browser payload changes", () => {
    const sources = buildEnvSources("test-key");
    const changed = sources.map((source) =>
      source.target === "/.agents/bin/browser"
        ? { ...source, content: `${source.content}\n# changed` }
        : source,
    );

    expect(payloadFingerprint(changed)).not.toBe(payloadFingerprint(sources));
  });
});
