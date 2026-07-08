import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runFilesDelete,
  runFilesDownload,
  runFilesGet,
  runFilesList,
  runFilesUpload
} from "../src/subcommands/files.js";

const genai = vi.hoisted(() => ({
  upload: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  download: vi.fn()
}));

vi.mock("../src/genaiClient.js", () => ({
  createGenAIClient: () => ({
    files: genai
  })
}));

describe("files commands", () => {
  beforeEach(() => {
    genai.upload.mockReset();
    genai.list.mockReset();
    genai.get.mockReset();
    genai.delete.mockReset();
    genai.download.mockReset();
  });

  it("uploads a file and returns its metadata", async () => {
    genai.upload.mockResolvedValueOnce({ name: "files/abc123", uri: "gs://x", mimeType: "audio/mpeg" });

    const result = await runFilesUpload("track.mp3", {});

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Uploaded as files/abc123");
    expect(result.details).toMatchObject({
      action: "upload",
      file: { name: "files/abc123", mimeType: "audio/mpeg" }
    });
    expect(genai.upload).toHaveBeenCalledWith(
      expect.objectContaining({ config: { mimeType: "audio/mpeg" } })
    );
  });

  it("lists files from an async-iterable pager", async () => {
    genai.list.mockResolvedValueOnce(
      (async function* () {
        yield { name: "files/a" };
        yield { name: "files/b" };
      })()
    );

    const result = await runFilesList();

    expect(result.stdout).toBe("files/a\nfiles/b");
    expect(result.details).toMatchObject({ action: "list", count: 2 });
  });

  it("gets and deletes files by name", async () => {
    genai.get.mockResolvedValueOnce({ name: "files/a", state: "ACTIVE" });
    const got = await runFilesGet("files/a");
    expect(got.details).toMatchObject({ file: { name: "files/a", state: "ACTIVE" } });

    genai.delete.mockResolvedValueOnce({});
    const deleted = await runFilesDelete("files/a");
    expect(deleted.message).toBe("Deleted files/a");
    expect(genai.delete).toHaveBeenCalledWith({ name: "files/a" });
  });

  it("downloads a file to --out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gai-files-"));
    const output = join(dir, "local.bin");

    try {
      genai.download.mockImplementationOnce(async ({ downloadPath }: { downloadPath: string }) => {
        await writeFile(downloadPath, "payload");
      });

      const result = await runFilesDownload("files/abc123", { out: output });

      expect(await readFile(output, "utf8")).toBe("payload");
      expect(result.outputs?.[0]?.path).toBe(output);
      expect(genai.download).toHaveBeenCalledWith(
        expect.objectContaining({ file: "files/abc123", downloadPath: output })
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
