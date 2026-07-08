import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { defaultOutputDir } from "./config.js";

const timestamp = (): string => new Date().toISOString().replace(/[:.]/g, "-");

export const ensureParentDir = async (filePath: string): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
};

export const resolveOutputPath = (
  requested: string | undefined,
  basename: string,
  extension: string
): string => {
  if (requested) {
    return resolve(requested);
  }
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  return resolve(defaultOutputDir(), timestamp(), `${basename}${ext}`);
};

export const writeBase64File = async (path: string, data: string): Promise<number> => {
  const buffer = Buffer.from(data, "base64");
  await ensureParentDir(path);
  await writeFile(path, buffer);
  return buffer.byteLength;
};

export const ensureWritableDirectory = async (directory: string): Promise<void> => {
  await mkdir(directory, { recursive: true });
  const probe = join(directory, `.write-test-${process.pid}`);
  try {
    await writeFile(probe, "ok");
  } finally {
    await rm(probe, { force: true });
  }
};

export const fileExists = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

export const extForMime = (mimeType: string, fallback: string): string => {
  if (mimeType.includes("png")) {
    return ".png";
  }
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    return ".jpg";
  }
  if (mimeType.includes("webp")) {
    return ".webp";
  }
  if (mimeType.includes("wav") || mimeType.includes("l16")) {
    return ".wav";
  }
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) {
    return ".mp3";
  }
  if (mimeType.includes("mp4")) {
    return ".mp4";
  }
  return extname(fallback) || fallback;
};

export type PrintOptions = {
  transform?: string;
  raw?: boolean;
};

// Dot-path extraction over the result object, e.g. "details.file.name" or "outputs.0.path".
export const extractPath = (value: unknown, path: string): unknown => {
  let current: unknown = value;
  for (const segment of path.split(".").filter((part) => part.length > 0)) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number.parseInt(segment, 10)];
      continue;
    }
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }
    return undefined;
  }
  return current;
};

const writeRaw = (value: unknown): void => {
  if (value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      writeRaw(item);
    }
    return;
  }
  if (typeof value === "string") {
    process.stdout.write(`${value}\n`);
    return;
  }
  if (typeof value === "object" && value !== null) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return;
  }
  process.stdout.write(`${String(value)}\n`);
};

export const printResult = (result: unknown, json: boolean, options: PrintOptions = {}): void => {
  if (options.transform) {
    const extracted = extractPath(result, options.transform);
    if (options.raw) {
      writeRaw(extracted);
    } else {
      process.stdout.write(`${JSON.stringify(extracted ?? null, null, 2)}\n`);
    }
    return;
  }
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (typeof result === "object" && result && "stdout" in result && typeof (result as { stdout?: unknown }).stdout === "string") {
    const text = (result as { stdout: string }).stdout;
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
    return;
  }
  if (typeof result === "object" && result && "outputs" in result) {
    const outputs = (result as { outputs?: Array<{ path: string }> }).outputs ?? [];
    for (const output of outputs) {
      process.stdout.write(`${output.path}\n`);
    }
    return;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
};
