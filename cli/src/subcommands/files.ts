import { basename, resolve } from "node:path";
import { lookup as lookupMime } from "mime-types";
import { createGenAIClient } from "../genaiClient.js";
import { ensureParentDir, fileExists, resolveOutputPath } from "../output.js";
import type { CommandResult } from "../types.js";

type UploadOptions = {
  mime?: string;
  json?: boolean;
  dryRun?: boolean;
};

type DownloadOptions = {
  out?: string;
  json?: boolean;
  dryRun?: boolean;
};

type FileRecord = Record<string, unknown>;

const toPlainFile = (value: unknown): FileRecord => {
  try {
    return JSON.parse(JSON.stringify(value)) as FileRecord;
  } catch {
    return { value: String(value) };
  }
};

export const runFilesUpload = async (filePath: string, options: UploadOptions): Promise<CommandResult> => {
  const resolved = resolve(filePath);
  const mimeType = options.mime || lookupMime(resolved) || "application/octet-stream";

  if (options.dryRun) {
    return {
      ok: true,
      capability: "files",
      message: "dry run",
      details: { action: "upload", file: resolved, mimeType }
    };
  }

  const ai = createGenAIClient();
  const uploaded = toPlainFile(
    await ai.files.upload({
      file: resolved,
      config: { mimeType }
    } as never)
  );

  return {
    ok: true,
    capability: "files",
    message: typeof uploaded.name === "string" ? `Uploaded as ${uploaded.name}` : "Uploaded",
    details: { action: "upload", file: uploaded }
  };
};

export const runFilesList = async (): Promise<CommandResult> => {
  const ai = createGenAIClient();
  const listing = (await ai.files.list({} as never)) as unknown;

  const files: FileRecord[] = [];
  if (listing && typeof listing === "object" && Symbol.asyncIterator in (listing as object)) {
    for await (const item of listing as AsyncIterable<unknown>) {
      files.push(toPlainFile(item));
    }
  } else if (Array.isArray(listing)) {
    files.push(...listing.map(toPlainFile));
  } else if (listing && typeof listing === "object" && Array.isArray((listing as { page?: unknown[] }).page)) {
    files.push(...((listing as { page: unknown[] }).page).map(toPlainFile));
  }

  return {
    ok: true,
    capability: "files",
    stdout: files
      .map((file) => (typeof file.name === "string" ? file.name : JSON.stringify(file)))
      .join("\n"),
    details: { action: "list", count: files.length, files }
  };
};

export const runFilesGet = async (name: string): Promise<CommandResult> => {
  const ai = createGenAIClient();
  const file = toPlainFile(await ai.files.get({ name } as never));
  return {
    ok: true,
    capability: "files",
    details: { action: "get", file }
  };
};

export const runFilesDelete = async (name: string): Promise<CommandResult> => {
  const ai = createGenAIClient();
  await ai.files.delete({ name } as never);
  return {
    ok: true,
    capability: "files",
    message: `Deleted ${name}`,
    details: { action: "delete", name }
  };
};

export const runFilesDownload = async (name: string, options: DownloadOptions): Promise<CommandResult> => {
  const outputPath = resolveOutputPath(options.out, basename(name) || "file", ".bin");

  if (options.dryRun) {
    return {
      ok: true,
      capability: "files",
      outputs: [{ path: outputPath, mimeType: "application/octet-stream" }],
      message: "dry run",
      details: { action: "download", name }
    };
  }

  const ai = createGenAIClient();
  await ensureParentDir(outputPath);
  await ai.files.download({
    file: name,
    downloadPath: outputPath
  } as never);

  if (!(await fileExists(outputPath))) {
    throw new Error(`Download completed but file was not found at ${outputPath}.`);
  }

  return {
    ok: true,
    capability: "files",
    outputs: [{ path: outputPath, mimeType: "application/octet-stream" }],
    details: { action: "download", name }
  };
};
