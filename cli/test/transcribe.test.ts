import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runTranscribe } from "../src/subcommands/transcribe.js";

const genai = vi.hoisted(() => ({
  upload: vi.fn(),
  create: vi.fn()
}));

vi.mock("../src/genaiClient.js", () => ({
  createGenAIClient: () => ({
    files: {
      upload: genai.upload
    },
    interactions: {
      create: genai.create
    }
  })
}));

describe("transcribe command", () => {
  it("supports dry runs without calling the API", async () => {
    const result = await runTranscribe("podcast.wav", {
      dryRun: true,
      out: "transcript.srt",
      format: "srt",
      language: "en-US"
    });

    expect(result.ok).toBe(true);
    expect(result.capability).toBe("transcribe");
    expect(result.model).toBe("gemini-3.5-flash");
    expect(result.outputs?.[0]).toMatchObject({
      path: expect.stringContaining("transcript.srt"),
      mimeType: "text/plain"
    });
    expect(result.details).toMatchObject({
      format: "srt",
      speakers: true,
      timestamps: true
    });
  });

  it("writes transcript output without returning transcript content in the result message", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gai-transcribe-"));
    const input = join(dir, "podcast.wav");
    const output = join(dir, "transcript.md");
    const transcript = "# Transcript\n\n[00:00] Speaker 1: hello from the recording";

    try {
      await writeFile(input, "fake audio", "utf8");
      genai.upload.mockResolvedValueOnce({
        uri: "https://files.example/audio",
        mimeType: "audio/wav",
        name: "files/audio"
      });
      genai.create.mockResolvedValueOnce({
        output_text: transcript
      });

      const result = await runTranscribe(input, { out: output });

      expect(await readFile(output, "utf8")).toBe(`${transcript}\n`);
      expect(result.outputs?.[0]).toMatchObject({
        path: output,
        mimeType: "text/markdown"
      });
      expect(result.message).toBe(`Transcript written to ${output}`);
      expect(result.message).not.toContain("Speaker 1");
      expect(result.details).toMatchObject({
        format: "markdown",
        transcriptCharacters: transcript.length
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
