import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { config as loadDotenv, parse as parseDotenv } from "dotenv";
import { AuthError } from "./errors.js";

let loaded = false;
let loadedEnvFiles: string[] = [];

const PLACEHOLDER_VALUES = new Set(["PLACEHOLDER", "YOUR_API_KEY", "YOUR_API_KEY_HERE"]);

const normalizeApiKey = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed || /[\r\n\0]/.test(trimmed) || PLACEHOLDER_VALUES.has(trimmed.toUpperCase())) {
    return undefined;
  }
  return trimmed;
};

export const userConfigDir = (): string => {
  const override = process.env.GEMINI_ANYTHING_CONFIG_DIR?.trim();
  if (override) {
    return resolve(override);
  }
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) {
    return resolve(xdg, "gai");
  }
  const appData = process.platform === "win32" ? process.env.APPDATA?.trim() : undefined;
  return appData ? resolve(appData, "gai") : join(homedir(), ".config", "gai");
};

export const userEnvPath = (): string => join(userConfigDir(), ".env");

export const readUserApiKey = (): string | undefined => {
  const path = userEnvPath();
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const parsed = parseDotenv(readFileSync(path, "utf8"));
    return normalizeApiKey(parsed.GOOGLE_API_KEY) || normalizeApiKey(parsed.GEMINI_API_KEY);
  } catch {
    return undefined;
  }
};

export const persistUserApiKey = (value: string): string => {
  const key = normalizeApiKey(value);
  if (!key) {
    throw new AuthError("Cannot persist an empty, placeholder, or malformed API key.");
  }
  const directory = userConfigDir();
  const path = userEnvPath();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  writeFileSync(path, `GEMINI_API_KEY=${key}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
};

export const clearUserApiKey = (): string => {
  const path = userEnvPath();
  rmSync(path, { force: true });
  return path;
};

const clearPlaceholderApiKeys = (): void => {
  if (process.env.GEMINI_API_KEY && !normalizeApiKey(process.env.GEMINI_API_KEY)) {
    delete process.env.GEMINI_API_KEY;
  }
  if (process.env.GOOGLE_API_KEY && !normalizeApiKey(process.env.GOOGLE_API_KEY)) {
    delete process.env.GOOGLE_API_KEY;
  }
};

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
  clearPlaceholderApiKeys();

  for (const file of [...new Set([...envCandidates(startDir), userEnvPath()])]) {
    if (existsSync(file)) {
      loadDotenv({ path: file, override: false, quiet: true });
      loadedEnvFiles.push(file);
      clearPlaceholderApiKeys();
    }
  }
  clearPlaceholderApiKeys();

  return loadedEnvFiles;
};

export const getApiKey = (): string | undefined => {
  loadEnvironment();
  return normalizeApiKey(process.env.GOOGLE_API_KEY) || normalizeApiKey(process.env.GEMINI_API_KEY);
};

export const requireApiKey = (): string => {
  const key = getApiKey();
  if (!key) {
    throw new AuthError(
      "GEMINI_API_KEY or GOOGLE_API_KEY is required. Export it, put it in a project .env, or persist it with 'gai config set-key'."
    );
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
    hasApiKey: Boolean(getApiKey())
  };
};
