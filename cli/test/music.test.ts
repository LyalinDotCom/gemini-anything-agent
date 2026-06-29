import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runMusic } from "../src/subcommands/music.js";

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

describe("music command", () => {
  beforeEach(() => {
    genai.create.mockReset();
  });

  it("supports dry runs without calling the API", async () => {
    const result = await runMusic("cozy synthwave theme", {
      dryRun: true,
      out: "theme.mp3",
      style: "warm instrumental"
    });

    expect(result.ok).toBe(true);
    expect(result.capability).toBe("music");
    expect(result.model).toBe("lyria-3-clip-preview");
    expect(result.outputs?.[0]).toMatchObject({
      path: expect.stringContaining("theme.mp3"),
      mimeType: "audio/mpeg"
    });
    expect(result.details).toMatchObject({
      apiSurface: "interactions",
      style: "warm instrumental",
      instrumental: false
    });
    expect(genai.create).not.toHaveBeenCalled();
  });

  it("writes music audio and optional text output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gai-music-"));
    const output = join(dir, "theme.mp3");
    const audio = Buffer.from("fake mp3").toString("base64");

    try {
      genai.create.mockResolvedValueOnce({
        output_audio: {
          data: audio,
          mime_type: "audio/mpeg"
        },
        output_text: "Generated structure notes"
      });

      const result = await runMusic("make a tiny theme", {
        out: output,
        style: "bright, optimistic",
        instrumental: true
      });

      expect(await readFile(output, "utf8")).toBe("fake mp3");
      expect(await readFile(join(dir, "theme.lyrics.txt"), "utf8")).toBe("Generated structure notes\n");
      expect(result.outputs).toEqual([
        { path: output, mimeType: "audio/mpeg" },
        { path: join(dir, "theme.lyrics.txt"), mimeType: "text/plain" }
      ]);
      expect(genai.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "lyria-3-clip-preview",
          input: expect.stringContaining("Instrumental only"),
          response_format: {
            type: "audio"
          }
        })
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
