import { describe, expect, it } from "vitest";
import { runTranscribe } from "../src/subcommands/transcribe.js";

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
});
