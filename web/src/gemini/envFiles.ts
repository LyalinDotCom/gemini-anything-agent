// Environment snapshot → client. The ONLY way media leaves the container:
// GET /files/environment-{envId}:download (a ustar tar, verified live incl. browser
// CORS), parse client-side, import new /workspace/output files into IndexedDB.
import { useStore } from "../state/store";
import type { OutputFileRecord } from "../state/types";
import { mediaId as makeMediaId, putMedia } from "../storage/messages";
import { contentFingerprint } from "../utils/contentFingerprint";
import { isVisibleOutputPath, normalizeOutputPath, outputLabel } from "../utils/outputPaths";
import { parseTar, parseTarStream, TarSizeLimitError, type TarEntry } from "../utils/tar";
import { resolveApiKey } from "./client";
import { FriendlyError, toFriendly } from "./errors";
import { syncEntriesToProject } from "../storage/localProjects";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const SEEN_CAP = 400;
const MAX_SNAPSHOT_BYTES = 100 * 1024 * 1024;

const MEDIA_KINDS: Record<string, { kind: "image" | "audio" | "video"; mime: string }> = {
  png: { kind: "image", mime: "image/png" },
  jpg: { kind: "image", mime: "image/jpeg" },
  jpeg: { kind: "image", mime: "image/jpeg" },
  gif: { kind: "image", mime: "image/gif" },
  webp: { kind: "image", mime: "image/webp" },
  svg: { kind: "image", mime: "image/svg+xml" },
  wav: { kind: "audio", mime: "audio/wav" },
  mp3: { kind: "audio", mime: "audio/mpeg" },
  m4a: { kind: "audio", mime: "audio/mp4" },
  ogg: { kind: "audio", mime: "audio/ogg" },
  mp4: { kind: "video", mime: "video/mp4" },
  webm: { kind: "video", mime: "video/webm" },
  mov: { kind: "video", mime: "video/quicktime" },
};

function classify(name: string): { kind: "image" | "audio" | "video" | "html" | "text" | "file"; mime: string } {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "html" || ext === "htm") return { kind: "html", mime: "text/html" };
  const textMimes: Record<string, string> = {
    md: "text/markdown", markdown: "text/markdown", txt: "text/plain", log: "text/plain",
    json: "application/json", jsonl: "application/x-ndjson", csv: "text/csv", tsv: "text/tab-separated-values",
    css: "text/css", js: "text/javascript", mjs: "text/javascript", ts: "text/plain", tsx: "text/plain",
    jsx: "text/plain", py: "text/x-python", sh: "text/x-shellscript", yaml: "application/yaml", yml: "application/yaml",
    xml: "application/xml", srt: "application/x-subrip", vtt: "text/vtt",
  };
  if (textMimes[ext]) return { kind: "text", mime: textMimes[ext] };
  return MEDIA_KINDS[ext] ?? { kind: "file", mime: "application/octet-stream" };
}

// One-downloader model: concurrent callers (post-turn sync + the Files panel)
// share a single in-flight snapshot fetch per environment.
const inflightDownloads = new Map<string, Promise<TarEntry[]>>();

async function fetchSnapshotResponse(envId: string): Promise<Response> {
  const key = resolveApiKey();
  if (!key) throw new FriendlyError("no-key", "No Gemini API key set.");
  const resp = await fetch(`${API_BASE}/files/environment-${envId}:download?alt=media`, {
    headers: { "x-goog-api-key": key },
  });
  if (!resp.ok) throw toFriendly(new Error(`API error (${resp.status}) downloading environment snapshot`));
  return resp;
}

function snapshotTooLarge(): FriendlyError {
  return new FriendlyError("bad-request", "Environment snapshot is too large to sync (>100MB).");
}

function bufferedSnapshot(buffer: ArrayBuffer, include: (name: string) => boolean): TarEntry[] {
  if (buffer.byteLength > MAX_SNAPSHOT_BYTES) throw snapshotTooLarge();
  return parseTar(buffer).filter((entry) => include(entry.name));
}

export function downloadSnapshot(envId: string): Promise<TarEntry[]> {
  const existing = inflightDownloads.get(envId);
  if (existing) return existing;
  const promise = (async () => {
    const include = (name: string) => normalizeOutputPath(name) !== null;
    const response = await fetchSnapshotResponse(envId);
    if (!response.body) return bufferedSnapshot(await response.arrayBuffer(), include);
    try {
      const streamed = await parseTarStream(response.body, include, MAX_SNAPSHOT_BYTES);
      if (streamed.unresolvedLinks.length === 0) return streamed.entries;
      // Rare: an output file is stored as a hard link to a body outside
      // /workspace/output. Only a full parse can resolve it — refetch buffered
      // (bounded by the same size cap the pre-streaming code enforced).
      return bufferedSnapshot(await (await fetchSnapshotResponse(envId)).arrayBuffer(), include);
    } catch (e) {
      if (e instanceof TarSizeLimitError) throw snapshotTooLarge();
      throw e;
    }
  })().finally(() => inflightDownloads.delete(envId));
  inflightDownloads.set(envId, promise);
  return promise;
}

export async function downloadSnapshotArchive(envId: string): Promise<Blob> {
  return (await fetchSnapshotResponse(envId)).blob();
}

export interface SyncedFile {
  fingerprint: string;
  path: string;
  label: string;
  kind: "image" | "audio" | "video" | "html" | "text" | "file";
  mediaId: string;
  mimeType: string;
  size: number;
  syncedAt: number;
}

export function outputFileMatchesPath(file: OutputFileRecord, requestedPath: string): boolean {
  const normalized = normalizeOutputPath(requestedPath);
  if (!normalized) return false;
  return file.path === normalized || outputLabel(file.path) === outputLabel(normalized);
}

function outputEntries(entries: TarEntry[]): TarEntry[] {
  return entries.filter((entry) => entry.size > 0 && isVisibleOutputPath(entry.name));
}

function recordsSignature(records: OutputFileRecord[] | undefined): string {
  return (records ?? []).map((record) => record.fingerprint).join("\n");
}

/** Import visible files under /workspace/output into IDB media storage. */
export async function syncOutputMedia(sessionId: string, envId: string): Promise<SyncedFile[]> {
  const entries = outputEntries(await downloadSnapshot(envId));
  const store = useStore.getState();
  const session = store.sessions[sessionId];
  if (!session) return [];
  const seen = new Set(session.envSeen ?? []);
  const existingByFingerprint = new Map((session.envFiles ?? []).map((file) => [file.fingerprint, file]));
  const nextFiles: OutputFileRecord[] = [];
  const fresh: SyncedFile[] = [];
  const now = Date.now();

  for (const entry of entries) {
    const normalized = normalizeOutputPath(entry.name);
    if (!normalized) continue;
    const fingerprint = await contentFingerprint(normalized, entry.data);
    const existing = existingByFingerprint.get(fingerprint);
    const { kind, mime } = classify(normalized);
    const mediaId = existing?.mediaId ?? makeMediaId(sessionId, `env-${normalized.replace(/[^a-z0-9.-]/gi, "_")}-${entry.size}`);
    if (!existing || !seen.has(fingerprint)) {
      await putMedia(mediaId, sessionId, new Blob([entry.data], { type: mime }), mime);
    }
    const record: OutputFileRecord = {
      fingerprint,
      path: normalized,
      label: outputLabel(normalized),
      kind,
      mediaId,
      mimeType: mime,
      size: entry.size,
      syncedAt: existing?.syncedAt ?? now,
    };
    nextFiles.push(record);
    if (!seen.has(fingerprint)) {
      seen.add(fingerprint);
      fresh.push(record);
    }
  }

  if (fresh.length > 0 || recordsSignature(session.envFiles) !== recordsSignature(nextFiles)) {
    useStore.getState().patchSession(sessionId, {
      envSeen: [...seen].slice(-SEEN_CAP),
      envFiles: nextFiles.slice(-SEEN_CAP),
    });
  }
  // A previously linked folder can receive updates without another prompt while
  // permission remains granted. Denied/prompt states are left for the explicit UI action.
  void syncEntriesToProject(sessionId, entries, false).catch(() => undefined);
  return fresh;
}
