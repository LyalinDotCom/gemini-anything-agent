import { readFile, writeFile } from "node:fs/promises";
import { createGenAIClient } from "../genaiClient.js";
import { defaultMusicModel } from "../models.js";
import { ensureParentDir, resolveOutputPath, writeBase64File } from "../output.js";
import type { CommandResult } from "../types.js";

type MusicOptions = {
  out?: string;
  model?: string;
  style?: string;
  lyrics?: string;
  lyricsFile?: string;
  instrumental?: boolean;
  negative?: string;
  json?: boolean;
  dryRun?: boolean;
};

const musicPrompt = async (prompt: string, options: MusicOptions): Promise<string> => {
  const lines = [prompt.trim()];
  if (options.style?.trim()) {
    lines.push(`Style: ${options.style.trim()}`);
  }
  if (options.instrumental) {
    lines.push("Instrumental only. Do not include vocals.");
  }
  if (options.lyricsFile) {
    lines.push("Lyrics:", (await readFile(options.lyricsFile, "utf8")).trim());
  }
  if (options.lyrics?.trim()) {
    lines.push("Lyrics:", options.lyrics.trim());
  }
  if (options.negative?.trim()) {
    lines.push(`Avoid: ${options.negative.trim()}`);
  }
  return lines.filter(Boolean).join("\n\n");
};

const lyricOutputPath = (audioPath: string): string => audioPath.replace(/\.[^/.]+$/, ".lyrics.txt");

export const runMusic = async (prompt: string, options: MusicOptions): Promise<CommandResult> => {
  const model = options.model || defaultMusicModel();
  const outputPath = resolveOutputPath(options.out, "music", ".mp3");
  const finalPrompt = await musicPrompt(prompt, options);

  if (options.dryRun) {
    return {
      ok: true,
      capability: "music",
      model,
      outputs: [{ path: outputPath, mimeType: "audio/mpeg" }],
      message: "dry run",
      details: {
        apiSurface: "interactions",
        style: options.style,
        instrumental: Boolean(options.instrumental),
        negative: options.negative
      }
    };
  }

  const ai = createGenAIClient();
  const interaction = (await ai.interactions.create({
    model,
    input: finalPrompt,
    response_format: {
      type: "audio"
    }
  } as never)) as {
    output_text?: string;
    output_audio?: {
      data?: string;
      mime_type?: string;
    };
  };

  const audio = interaction.output_audio;
  if (!audio?.data) {
    throw new Error(`Music model ${model} did not return output_audio.data.`);
  }

  const returnedMime = audio.mime_type || "audio/mpeg";
  await writeBase64File(outputPath, audio.data);

  const outputs = [{ path: outputPath, mimeType: returnedMime }];
  if (interaction.output_text?.trim()) {
    const textPath = lyricOutputPath(outputPath);
    await ensureParentDir(textPath);
    await writeFile(textPath, `${interaction.output_text.trim()}\n`, "utf8");
    outputs.push({ path: textPath, mimeType: "text/plain" });
  }

  return {
    ok: true,
    capability: "music",
    model,
    outputs,
    message: interaction.output_text?.trim()
  };
};
