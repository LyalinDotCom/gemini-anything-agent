import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runGenerate } from "../src/subcommands/generate.js";

const genai = vi.hoisted(() => ({
  create: vi.fn()
}));

vi.mock("../src/genaiClient.js", () => ({
  createGenAIClient: () => ({
    interactions: {
      create: genai.create
    }
  })
}));

describe("generate command", () => {
  beforeEach(() => {
    genai.create.mockReset();
  });

  it("supports dry runs without calling the API", async () => {
    const result = await runGenerate("say hi", {
      dryRun: true,
      search: true,
      temperature: "0.2"
    });

    expect(result.ok).toBe(true);
    expect(result.capability).toBe("generate");
    expect(result.model).toBe("gemini-3.5-pro");
    expect(result.details).toMatchObject({
      apiSurface: "interactions",
      request: expect.objectContaining({
        tools: [{ type: "google_search" }],
        generation_config: { temperature: 0.2 }
      })
    });
    expect(genai.create).not.toHaveBeenCalled();
  });

  it("returns the generated text as stdout and writes --out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gai-generate-"));
    const output = join(dir, "answer.md");

    try {
      genai.create.mockResolvedValueOnce({ output_text: "Hello there." });

      const result = await runGenerate("say hi", {
        out: output,
        system: "Be brief."
      });

      expect(result.stdout).toBe("Hello there.");
      expect(await readFile(output, "utf8")).toBe("Hello there.\n");
      expect(result.outputs).toEqual([{ path: output, mimeType: "text/plain" }]);
      expect(genai.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gemini-3.5-pro",
          input: "say hi",
          system_instruction: "Be brief."
        })
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("passes a JSON schema and rejects non-JSON output", async () => {
    genai.create.mockResolvedValueOnce({ output_text: "not json" });

    await expect(
      runGenerate("extract fields", { schema: '{"type":"object"}' })
    ).rejects.toThrow(/did not parse as JSON/);

    expect(genai.create).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: { type: "object" }
        }
      })
    );
  });

  it("builds Interactions API tool declarations for every tool flag", async () => {
    genai.create.mockResolvedValueOnce({ output_text: "done" });

    await runGenerate("use tools", {
      search: true,
      urlContext: true,
      codeExecution: true
    });

    expect(genai.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          { type: "google_search" },
          { type: "url_context" },
          { type: "code_execution" }
        ]
      })
    );
  });

  it("builds multimodal input parts from --file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gai-generate-"));
    const image = join(dir, "photo.png");
    const notes = join(dir, "notes.txt");

    try {
      await writeFile(image, Buffer.from("fake png"));
      await writeFile(notes, "context notes", "utf8");
      genai.create.mockResolvedValueOnce({ output_text: '{"ok":true}' });

      const result = await runGenerate("describe", {
        file: [image, notes],
        schema: '{"type":"object"}'
      });

      expect(result.stdout).toBe('{"ok":true}');
      expect(genai.create).toHaveBeenCalledWith(
        expect.objectContaining({
          input: [
            {
              type: "image",
              data: Buffer.from("fake png").toString("base64"),
              mime_type: "image/png"
            },
            { type: "text", text: "context notes" },
            { type: "text", text: "describe" }
          ]
        })
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
