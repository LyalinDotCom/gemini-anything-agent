import { AuthError } from "../errors.js";
import {
  clearUserApiKey,
  envLoadReport,
  getApiKey,
  persistUserApiKey,
  readUserApiKey,
  userEnvPath
} from "../config.js";
import type { CommandResult } from "../types.js";

type SetKeyOptions = {
  stdin?: boolean;
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
};

export const runConfigSetKey = async (options: SetKeyOptions): Promise<CommandResult> => {
  const key = options.stdin ? await readStdin() : getApiKey();
  if (!key) {
    throw new AuthError(
      options.stdin
        ? "No API key was received on stdin."
        : "No API key is currently resolved. Run this inside a project with .env, export a key temporarily, or use --stdin."
    );
  }
  const path = persistUserApiKey(key);
  return {
    ok: true,
    capability: "config",
    stdout: `Saved the global API key to ${path}`,
    details: { action: "set-key", path }
  };
};

export const runConfigStatus = (): CommandResult => {
  const path = userEnvPath();
  const globalKeyConfigured = Boolean(readUserApiKey());
  const env = envLoadReport();
  return {
    ok: true,
    capability: "config",
    stdout: globalKeyConfigured
      ? `Global API key configured at ${path}`
      : `No global API key configured at ${path}`,
    details: {
      action: "status",
      path,
      globalKeyConfigured,
      effectiveKeyAvailable: env.hasApiKey,
      loadedEnvFiles: env.loadedEnvFiles
    }
  };
};

export const runConfigClearKey = (): CommandResult => {
  const path = clearUserApiKey();
  return {
    ok: true,
    capability: "config",
    stdout: `Cleared the global API key from ${path}`,
    details: { action: "clear-key", path }
  };
};
