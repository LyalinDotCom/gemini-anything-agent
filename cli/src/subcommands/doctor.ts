import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { envLoadReport, defaultOutputDir } from "../config.js";
import { MODEL_REGISTRY } from "../models.js";
import type { CommandResult } from "../types.js";

export const runDoctor = async (): Promise<CommandResult> => {
  const env = envLoadReport();
  const outputDir = resolve(defaultOutputDir());
  let outputWritable = false;
  let outputError: string | undefined;

  try {
    await mkdir(outputDir, { recursive: true });
    const probe = join(outputDir, `.gai-write-test-${process.pid}`);
    await writeFile(probe, "ok");
    await rm(probe, { force: true });
    outputWritable = true;
  } catch (error) {
    outputError = error instanceof Error ? error.message : String(error);
  }

  return {
    ok: true,
    capability: "doctor",
    message: env.hasApiKey && outputWritable ? "gai is ready" : "gai needs attention",
    details: {
      hasApiKey: env.hasApiKey,
      loadedEnvFileCount: env.loadedEnvFiles.length,
      loadedEnvFiles: env.loadedEnvFiles,
      outputDir,
      outputWritable,
      outputError,
      nodeVersion: process.version,
      platform: process.platform,
      models: MODEL_REGISTRY.map((model) => ({
        id: model.id,
        capability: model.capability,
        isDefault: "isDefault" in model && model.isDefault === true
      }))
    }
  };
};
