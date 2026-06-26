import { existsSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

let loaded = false;
let loadedEnvFiles: string[] = [];

const envCandidates = (startDir: string): string[] => {
  const files: string[] = [];
  let current = resolve(startDir);
  const root = parse(current).root;

  while (true) {
    files.push(join(current, ".env"));
    files.push(join(current, ".env.local"));
    if (current === root) {
      break;
    }
    current = dirname(current);
  }

  return files;
};

export const loadEnvironment = (startDir = process.cwd()): string[] => {
  if (loaded) {
    return loadedEnvFiles;
  }
  loaded = true;
  loadedEnvFiles = [];

  for (const file of envCandidates(startDir)) {
    if (existsSync(file)) {
      loadDotenv({ path: file, override: false, quiet: true });
      loadedEnvFiles.push(file);
    }
  }

  return loadedEnvFiles;
};

export const getApiKey = (): string | undefined => {
  loadEnvironment();
  return process.env.GEMINI_API_KEY;
};

export const requireApiKey = (): string => {
  const key = getApiKey();
  if (!key) {
    throw new Error("GEMINI_API_KEY is required. Put it in .env or export it in the environment.");
  }
  return key;
};

export const defaultOutputDir = (): string => {
  loadEnvironment();
  return process.env.GEMINI_ANYTHING_OUTPUT_DIR || (process.env.AGENT_ENVIRONMENT_ID ? "/workspace/output" : "outputs");
};

export const envLoadReport = (): { loadedEnvFiles: string[]; hasApiKey: boolean } => {
  const files = loadEnvironment();
  return {
    loadedEnvFiles: files,
    hasApiKey: Boolean(process.env.GEMINI_API_KEY)
  };
};

