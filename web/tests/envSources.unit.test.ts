import { describe, expect, test } from "vitest";
import { buildEnvSources, payloadFingerprint } from "../src/gemini/envSources";
import { readFileSync } from "node:fs";
import { AGENT_ASSET_PATHS } from "../../shared/agentAssets";

describe("shared managed-agent payload", () => {
  test("mounts the media and headless-browser capabilities", () => {
    const sources = buildEnvSources("test-key");
    const byTarget = new Map(sources.map((source) => [source.target, source.content]));

    expect(byTarget.get("/.agents/AGENTS.md")).toContain("Headless browser wrapper");
    expect(sources.filter(source => source.target.startsWith("/.agents/bin/")).map(source => source.target).sort()).toEqual(["/.agents/bin/browser", "/.agents/bin/gemini-api", "/.agents/bin/large-image-setup", "/.agents/bin/object3d-setup"]);
    expect(byTarget.get("/.agents/bin/gemini-api")).toContain("google-gemini/gemini-api-cli");
    expect(byTarget.get("/.agents/bin/browser")).toContain("@playwright/cli");
    expect(byTarget.get("/.agents/bin/browser")).toContain('PLAYWRIGHT_MCP_SANDBOX="${PLAYWRIGHT_MCP_SANDBOX:-false}"');
    expect(byTarget.get("/.agents/bin/browser")).toContain('"browserName":"chromium"');
    expect(byTarget.get("/.agents/skills/gemini-anywhere/SKILL.md")).toContain("Gemini API Media Skill");
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

  test("mounts every shared asset byte-identically to the Electron disk payload", () => {
    const sources = buildEnvSources("test-key");
    for (const path of AGENT_ASSET_PATHS) {
      const mounted = sources.find((source) => source.target === `/.agents/${path}`);
      expect(mounted?.content).toBe(readFileSync(new URL(`../../agents/${path}`, import.meta.url), "utf8"));
    }
    expect(sources).toHaveLength(AGENT_ASSET_PATHS.length + 1);
  });
});
