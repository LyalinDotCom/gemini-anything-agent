import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const skill = readFileSync(resolve("..", "agents", "skills", "gemini-anything", "SKILL.md"), "utf8");
const agents = readFileSync(resolve("..", "agents", "AGENTS.md"), "utf8");
const systemPrompt = readFileSync(resolve("..", "agents", "system-prompt.md"), "utf8");

describe("agent skill contract", () => {
  it("routes only specialized media work to gai", () => {
    expect(skill).toContain("Use the CLI only for:");
    expect(skill).toContain("Images:");
    expect(skill).toContain("Video:");
    expect(skill).toContain("TTS:");
    expect(skill).toContain("Music:");
    expect(skill).toContain("Transcription:");
    expect(skill).toContain("Do not use this skill for ordinary text");
    expect(skill).toContain("audio transcription");
    expect(agents).toContain("use native managed-agent tools");
    expect(agents).toContain("use `gai transcribe`");
    expect(agents).toContain("music generation");
    expect(agents).toContain("Do not paste transcript contents");
    expect(agents).toContain("Workspace root: `/workspace`");
    expect(agents).toContain("inspect `/workspace/output`");
    expect(systemPrompt).toContain("## Runtime Facts");
    expect(systemPrompt).toContain("## Operating Loop");
    expect(systemPrompt).toContain("Do not use `gai` for ordinary text answers");
    expect(systemPrompt).toContain("do not paste the full transcript");
  });

  it("uses the wrapper, help discovery, and JSON output", () => {
    expect(skill).toContain('export GAI="/.agents/bin/gai"');
    expect(skill).toContain("gai wrapper is missing");
    expect(skill).toContain('bash "$GAI" --help');
    expect(skill).toContain('bash "$GAI" tts --help');
    expect(skill).toContain('bash "$GAI" music --help');
    expect(skill).toContain('bash "$GAI" transcribe --help');
    expect(skill).toContain("Follow the current help output; it is the source of truth.");
    expect(skill).toContain("do not paste the transcript contents");
    expect(skill).toContain("--json");
    expect(skill).toContain("Never run bare `gai ...`");
    expect(skill).toContain("Never create your own wrapper");
    expect(skill).toContain("Never execute `dist/cli.js`");
    expect(skill).toContain("Never run `npm install`");
    expect(skill).toContain("API_KEY_INVALID");
  });
});
