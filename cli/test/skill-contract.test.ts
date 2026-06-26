import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const skill = readFileSync(resolve("..", "agents", "skills", "gemini-anything", "SKILL.md"), "utf8");
const agents = readFileSync(resolve("..", "agents", "AGENTS.md"), "utf8");
const systemPrompt = readFileSync(resolve("..", "agents", "system-prompt.md"), "utf8");

describe("agent skill contract", () => {
  it("routes only specialized media work to gai", () => {
    expect(skill).toContain("gai image");
    expect(skill).toContain("gai video");
    expect(skill).toContain("gai tts");
    expect(skill).toContain("Do not use this skill for ordinary text");
    expect(agents).toContain("Use native managed-agent tools");
    expect(systemPrompt).toContain("Do not use `gai` for ordinary text answers");
  });

  it("uses npm/npx invocation and JSON output", () => {
    expect(skill).toContain("npx -y");
    expect(skill).toContain("--json");
    expect(skill).toContain("GEMINI_ANYTHING_NPM_PACKAGE");
    expect(skill).toContain("GEMINI_ANYTHING_NPM_VERSION");
  });
});

