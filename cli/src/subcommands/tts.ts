import { readFile } from "node:fs/promises";
import { createGenAIClient } from "../genaiClient.js";
import { defaultTtsModel } from "../models.js";
import { resolveOutputPath, writeBase64File, ensureParentDir } from "../output.js";
import type { CommandResult } from "../types.js";

type TtsOptions = {
  out?: string;
  voice?: string;
  speaker?: string;
  language?: string;
  model?: string;
  scriptFile?: string;
  mime?: string;
  json?: boolean;
  dryRun?: boolean;
};

const writeWavFromPcm = async (
  path: string,
  pcm: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample = 16
): Promise<number> => {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  await ensureParentDir(path);
  await import("node:fs/promises").then(({ writeFile }) => writeFile(path, Buffer.concat([header, pcm])));
  return header.length + pcm.length;
};

export const runTts = async (prompt: string, options: TtsOptions): Promise<CommandResult> => {
  const model = options.model || defaultTtsModel();
  const script = options.scriptFile ? await readFile(options.scriptFile, "utf8") : prompt;
  const mimeType = options.mime || "audio/wav";
  const outputPath = resolveOutputPath(options.out, "narration", ".wav");

  if (options.dryRun) {
    return {
      ok: true,
      capability: "tts",
      model,
      outputs: [{ path: outputPath, mimeType }],
      message: "dry run",
      details: {
        apiSurface: "interactions",
        voice: options.voice || "Kore",
        speaker: options.speaker,
        language: options.language
      }
    };
  }

  const speechConfig: Record<string, string> = {
    voice: options.voice || "Kore"
  };
  if (options.language) {
    speechConfig.language = options.language;
  }
  if (options.speaker) {
    speechConfig.speaker = options.speaker;
  }

  const ai = createGenAIClient();
  const interaction = (await ai.interactions.create({
    model,
    input: script,
    response_format: {
      type: "audio"
    },
    generation_config: {
      speech_config: [speechConfig]
    }
  } as never)) as {
    output_audio?: {
      data?: string;
      mime_type?: string;
      channels?: number;
      sample_rate?: number;
    };
  };

  const audio = interaction.output_audio;
  if (!audio?.data) {
    throw new Error(`TTS model ${model} did not return output_audio.data.`);
  }

  const returnedMime = audio.mime_type || mimeType;
  if (returnedMime.includes("l16")) {
    await writeWavFromPcm(
      outputPath,
      Buffer.from(audio.data, "base64"),
      audio.sample_rate || 24000,
      audio.channels || 1
    );
  } else {
    await writeBase64File(outputPath, audio.data);
  }

  return {
    ok: true,
    capability: "tts",
    model,
    outputs: [{ path: outputPath, mimeType: returnedMime.includes("l16") ? "audio/wav" : returnedMime }]
  };
};
