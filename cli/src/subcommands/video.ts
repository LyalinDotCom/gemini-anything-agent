import { rm } from "node:fs/promises";
import { createGenAIClient } from "../genaiClient.js";
import { videoModelForQuality, type VideoQuality } from "../models.js";
import { ensureParentDir, fileExists, resolveOutputPath } from "../output.js";
import type { CommandResult } from "../types.js";

type VideoOptions = {
  out?: string;
  quality?: VideoQuality;
  aspect?: string;
  resolution?: string;
  duration?: string;
  pollInterval?: string;
  timeout?: string;
  json?: boolean;
  dryRun?: boolean;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseQuality = (value: string | undefined): VideoQuality => {
  if (value === "premium" || value === "fast-premium" || value === "lite" || value === undefined) {
    return value ?? "lite";
  }
  throw new Error(`Unsupported video quality "${value}". Use lite, premium, or fast-premium.`);
};

export const runVideo = async (prompt: string, options: VideoOptions): Promise<CommandResult> => {
  const quality = parseQuality(options.quality);
  const model = videoModelForQuality(quality);
  const outputPath = resolveOutputPath(options.out, "video", ".mp4");
  const aspectRatio = options.aspect || "16:9";
  const resolution = options.resolution || (quality === "lite" ? "720p" : "1080p");

  if (options.dryRun) {
    return {
      ok: true,
      capability: "video",
      model,
      outputs: [{ path: outputPath, mimeType: "video/mp4" }],
      message: "dry run",
      details: {
        apiSurface: "generateVideos",
        quality,
        aspectRatio,
        resolution,
        durationSeconds: parsePositiveInt(options.duration, 8)
      }
    };
  }

  const ai = createGenAIClient();
  let operation = await ai.models.generateVideos({
    model,
    prompt,
    config: {
      numberOfVideos: 1,
      aspectRatio,
      resolution,
      durationSeconds: parsePositiveInt(options.duration, 8)
    }
  });

  const pollIntervalMs = parsePositiveInt(options.pollInterval, 10) * 1000;
  const timeoutMs = parsePositiveInt(options.timeout, 900) * 1000;
  const startedAt = Date.now();

  while (!operation.done) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for video operation ${operation.name ?? "(unknown operation)"}.`);
    }
    process.stderr.write(".");
    await sleep(pollIntervalMs);
    operation = await ai.operations.getVideosOperation({ operation });
  }
  process.stderr.write("\n");

  if (operation.error) {
    throw new Error(`Video operation failed: ${JSON.stringify(operation.error)}`);
  }

  const generated = operation.response?.generatedVideos?.[0];
  if (!generated?.video) {
    throw new Error(`Video model ${model} did not return a generated video.`);
  }

  await ensureParentDir(outputPath);
  try {
    await ai.files.download({
      file: generated.video,
      downloadPath: outputPath
    });
  } catch (error) {
    await rm(outputPath, { force: true });
    throw error;
  }

  if (!(await fileExists(outputPath))) {
    throw new Error(`Video download completed but file was not found at ${outputPath}.`);
  }

  return {
    ok: true,
    capability: "video",
    model,
    operation: {
      name: operation.name,
      done: operation.done
    },
    outputs: [{ path: outputPath, mimeType: "video/mp4" }]
  };
};
