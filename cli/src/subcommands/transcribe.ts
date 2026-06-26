import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { lookup as lookupMime } from "mime-types";
import { createGenAIClient } from "../genaiClient.js";
import { defaultTranscribeModel } from "../models.js";
import { ensureParentDir, resolveOutputPath } from "../output.js";
import type { CommandResult } from "../types.js";

type TranscriptFormat = "markdown" | "text" | "srt" | "json";

type TranscribeOptions = {
  out?: string;
  model?: string;
  prompt?: string;
  language?: string;
  format?: TranscriptFormat;
  speakers?: boolean;
  timestamps?: boolean;
  mime?: string;
  json?: boolean;
  dryRun?: boolean;
};

const parseFormat = (value: string | undefined): TranscriptFormat => {
  if (!value) {
    return "markdown";
  }
  if (value === "markdown" || value === "text" || value === "srt" || value === "json") {
    return value;
  }
  throw new Error(`Unsupported transcript format "${value}". Use markdown, text, srt, or json.`);
};

const extensionForFormat = (format: TranscriptFormat): string => {
  if (format === "srt") {
    return ".srt";
  }
  if (format === "json") {
    return ".json";
  }
  if (format === "text") {
    return ".txt";
  }
  return ".md";
};

const mimeForFormat = (format: TranscriptFormat): string => {
  if (format === "json") {
    return "application/json";
  }
  if (format === "markdown") {
    return "text/markdown";
  }
  return "text/plain";
};

const transcriptionPrompt = (
  format: TranscriptFormat,
  options: TranscribeOptions
): string => {
  const lines = [
    "Transcribe the provided audio file.",
    "Capture spoken words accurately and preserve the meaning of unclear phrases.",
    options.timestamps === false
      ? "Do not include timestamps unless they are needed to disambiguate the audio."
      : "Include timestamps for each segment.",
    options.speakers === false
      ? "Do not add speaker labels unless speaker identity is explicit in the audio."
      : "Identify distinct speakers with stable labels such as Speaker 1, Speaker 2, Host, or Guest when possible.",
    "Note important non-speech audio only when it affects understanding, such as music, applause, silence, or sound effects."
  ];

  if (options.language) {
    lines.push(`The expected language or locale is ${options.language}.`);
  }

  if (format === "srt") {
    lines.push("Return valid SubRip .srt only. Do not wrap it in Markdown.");
  } else if (format === "json") {
    lines.push(
      'Return JSON only with a top-level "segments" array. Each segment should include start, end, speaker, text, and notes when available.'
    );
  } else if (format === "text") {
    lines.push("Return plain text only.");
  } else {
    lines.push("Return clean Markdown with concise headings only if useful.");
  }

  if (options.prompt?.trim()) {
    lines.push("Additional user instructions:", options.prompt.trim());
  }

  return lines.join("\n");
};

export const runTranscribe = async (
  filePath: string,
  options: TranscribeOptions
): Promise<CommandResult> => {
  const format = parseFormat(options.format);
  const model = options.model || defaultTranscribeModel();
  const resolvedFilePath = resolve(filePath);
  const mimeType = options.mime || lookupMime(resolvedFilePath) || "application/octet-stream";
  const outputPath = resolveOutputPath(options.out, "transcript", extensionForFormat(format));
  const outputMime = mimeForFormat(format);
  const prompt = transcriptionPrompt(format, options);

  if (options.dryRun) {
    return {
      ok: true,
      capability: "transcribe",
      model,
      outputs: [{ path: outputPath, mimeType: outputMime }],
      message: "dry run",
      details: {
        apiSurface: "interactions",
        file: resolvedFilePath,
        mimeType,
        format,
        speakers: options.speakers !== false,
        timestamps: options.timestamps !== false
      }
    };
  }

  const ai = createGenAIClient();
  const uploaded = (await ai.files.upload({
    file: resolvedFilePath,
    config: {
      mimeType
    }
  } as never)) as {
    uri?: string;
    mimeType?: string;
    mime_type?: string;
    name?: string;
  };

  if (!uploaded.uri) {
    throw new Error(`Audio upload completed but did not return a file URI for ${resolvedFilePath}.`);
  }

  const interaction = (await ai.interactions.create({
    model,
    input: [
      {
        type: "text",
        text: prompt
      },
      {
        type: "audio",
        uri: uploaded.uri,
        mime_type: uploaded.mimeType || uploaded.mime_type || mimeType
      }
    ]
  } as never)) as {
    output_text?: string;
  };

  const transcript = interaction.output_text?.trim();
  if (!transcript) {
    throw new Error(`Transcription model ${model} did not return output_text.`);
  }

  await ensureParentDir(outputPath);
  await writeFile(outputPath, `${transcript}\n`, "utf8");

  return {
    ok: true,
    capability: "transcribe",
    model,
    outputs: [{ path: outputPath, mimeType: outputMime }],
    message: transcript,
    details: {
      inputFile: resolvedFilePath,
      inputMimeType: mimeType,
      uploadedFile: uploaded.name,
      format
    }
  };
};
