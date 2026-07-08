import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runEmbed } from "../src/subcommands/embed.js";

const genai = vi.hoisted(() => ({
  embedContent: vi.fn()
}));

vi.mock("../src/genaiClient.js", () => ({
  createGenAIClient: () => ({
    models: {
      embedContent: genai.embedContent
    }
  })
}));

describe("embed command", () => {
  beforeEach(() => {
    genai.embedContent.mockReset();
  });

  it("supports dry runs without calling the API", async () => {
    const result = await runEmbed("hello", { dryRun: true, dim: "768" });

    expect(result.ok).toBe(true);
    expect(result.capability).toBe("embed");
    expect(result.model).toBe("gemini-embedding-001");
    expect(result.details).toMatchObject({ apiSurface: "embedContent", outputDimensionality: 768 });
    expect(genai.embedContent).not.toHaveBeenCalled();
  });

  it("returns vector details and writes --out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gai-embed-"));
    const output = join(dir, "vector.json");

    try {
      genai.embedContent.mockResolvedValueOnce({
        embeddings: [{ values: [0.1, 0.2, 0.3] }]
      });

      const result = await runEmbed("hello world", { out: output });

      expect(result.details).toMatchObject({ dimensions: 3, values: [0.1, 0.2, 0.3] });
      expect(JSON.parse(await readFile(output, "utf8"))).toEqual([0.1, 0.2, 0.3]);
      expect(genai.embedContent).toHaveBeenCalledWith(
        expect.objectContaining({ model: "gemini-embedding-001", contents: "hello world" })
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects missing input with a usage error", async () => {
    await expect(runEmbed(undefined, {})).rejects.toThrow(/Provide text to embed/);
    expect(genai.embedContent).not.toHaveBeenCalled();
  });
});
