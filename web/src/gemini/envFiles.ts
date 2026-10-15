// Environment artifacts → client. Prefer the snapshot archive; environments
// without its Files API alias use the SDK's native environment-file download.
import { useStore } from "../state/store";
import type { OutputFileRecord } from "../state/types";
import { mediaId as makeMediaId, putMedia } from "../storage/messages";
import { contentFingerprint } from "../utils/contentFingerprint";
import { validOutputSignature } from "../utils/outputIntegrity";
import { isVisibleOutputPath, normalizeOutputPath, outputLabel } from "../utils/outputPaths";
import { createTarBlob, parseTar, parseTarStream, TarSizeLimitError, type TarEntry } from "../utils/tar";
import { ai, resolveApiKey } from "./client";
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
  if (ext === "glb") return { kind: "file", mime: "model/gltf-binary" };
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

export async function listOutputFiles(envId: string): Promise<Array<{ path: string; size: number }>> {
  const files: Array<{ path: string; size: number }> = [];
  let pageToken: string | undefined;
  do {
    const page = await ai().environments.files.list({ environment: envId, path: "/workspace/output", recursive: true, page_size: 200, ...(pageToken ? { page_token: pageToken } : {}) });
    for (const file of page.files ?? []) {
      const size = Number(file.size_bytes);
      const path = file.path && normalizeOutputPath(file.path);
      if (String(file.type).toLowerCase() === "file" && path && isVisibleOutputPath(path) && size > 0 && Number.isSafeInteger(size)) files.push({ path, size });
    }
    pageToken = page.next_page_token;
  } while (pageToken);
  return files;
}
class UnstableFileBody extends FriendlyError {}
class PartialOutputError extends FriendlyError {
  constructor(readonly entries: TarEntry[], failures: Error[], readonly paths: string[]) {
    super('bad-request', `Some output files could not sync. ${failures.map(error=>error.message).join(' ')}`);
  }
}
export async function downloadOutputFile(envId: string, file: {path:string;size:number}): Promise<TarEntry> {
  const path = normalizeOutputPath(file.path);
  if (!path || !isVisibleOutputPath(path)) throw new Error('Invalid output path.');
  let data: Uint8Array<ArrayBuffer> | undefined;
  let expectedSize = file.size;
  for (let attempt=0;attempt<3;attempt++) {
    try {
      const candidate = new Uint8Array(await ai().environments.files.download({environment:envId,path}));
      if (candidate.byteLength !== expectedSize) {
        const current = (await listOutputFiles(envId)).find(entry=>entry.path===path);
        if (current?.size === candidate.byteLength) expectedSize = current.size;
        else throw new UnstableFileBody('bad-request', `Output file changed during transfer: ${outputLabel(path)}. Check output files after the running step finishes.`);
      }
      if (!validOutputSignature(path,candidate)) throw new UnstableFileBody('bad-request', `Gemini returned invalid bytes for ${outputLabel(path)}. The file was not synced. Check output files after the running step finishes.`);
      data = candidate; break;
    }
    catch (error) {
      const snapshotUpdating = /snapshot\.tar/i.test(String((error as Error)?.message)) && /not.?found|no such object/i.test(String((error as Error)?.message));
      const unstableBody = error instanceof UnstableFileBody;
      if (!snapshotUpdating && !unstableBody) throw error;
      if (attempt===2) {
        if (unstableBody) throw error;
        throw new FriendlyError('network','The container is updating its saved files. Check output files after the running step finishes.');
      }
      await new Promise(resolve=>setTimeout(resolve,1500));
    }
  }
  if (!data) throw new Error("Output download returned no bytes.");
  return {name:path,size:data.byteLength,data};
}
async function downloadOutputFiles(envId: string, selected?: Array<{ path: string; size: number }>): Promise<TarEntry[]> {
  const files = selected ?? await listOutputFiles(envId);
  if (files.reduce((total,file)=>total+file.size,0)>MAX_SNAPSHOT_BYTES) throw snapshotTooLarge();
  const entries: TarEntry[] = [];
  const failures: Error[] = [];
  const failedPaths: string[] = [];
  // Bound memory and request concurrency while downloading independent files.
  for (let offset = 0; offset < files.length; offset += 3) {
    const group = await Promise.allSettled(files.slice(offset, offset + 3).map(file => downloadOutputFile(envId,file)));
    for (const [index,result] of group.entries()) {
      if (result.status==='fulfilled') entries.push(result.value);
      else if (result.reason instanceof UnstableFileBody) { failures.push(result.reason);failedPaths.push(files[offset+index].path); }
      else throw result.reason;
    }
  }
  if (failures.length) throw new PartialOutputError(entries,failures,failedPaths);
  return entries;
}

export function downloadSnapshot(envId: string, preferNativeFiles = false): Promise<TarEntry[]> {
  const downloadKey = `${envId}:${preferNativeFiles ? "native" : "archive"}`;
  const existing = inflightDownloads.get(downloadKey);
  if (existing) return existing;
  const promise = (async () => {
    if (preferNativeFiles) return downloadOutputFiles(envId);
    const include = (name: string) => normalizeOutputPath(name) !== null;
    let response: Response;
    try { response = await fetchSnapshotResponse(envId); }
    catch (error) {
      if (toFriendly(error).kind === "not-found") return downloadOutputFiles(envId);
      throw error;
    }
    if (!response.body) return bufferedSnapshot(await response.arrayBuffer(), include);
    try {
      const streamed = await parseTarStream(response.body, include, MAX_SNAPSHOT_BYTES);
      if (streamed.unresolvedLinks.length === 0) return streamed.entries;
      // Fetch output files individually rather than buffering unrelated caches.
      return downloadOutputFiles(envId);
    } catch (e) {
      if (e instanceof TarSizeLimitError) throw snapshotTooLarge();
      throw e;
    }
  })().finally(() => inflightDownloads.delete(downloadKey));
  inflightDownloads.set(downloadKey, promise);
  return promise;
}

export async function downloadSnapshotArchive(envId: string, preferNativeFiles = false): Promise<Blob> {
  if (preferNativeFiles) return createTarBlob(await downloadSnapshot(envId, true));
  try { return await (await fetchSnapshotResponse(envId)).blob(); }
  catch (error) {
    if (toFriendly(error).kind === "not-found") return createTarBlob(await downloadOutputFiles(envId));
    throw error;
  }
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

export function isLargeImageDeliverable(path: string): boolean {
  return !/(?:^|\/)(?:tiles|deepzoom)\//i.test(path) && !/(?:^|\/)(?:ref_|request_|tile_r)/i.test(path);
}
export function selectLargeImageDownloads(files: Array<{path:string;size:number}>): Array<{path:string;size:number}> {
  const priority = (path: string) => /deepzoom\.zip$/i.test(path) ? 0 : /preview_overview\.jpg$/i.test(path) ? 1 : /\.json$/i.test(path) ? 2 : 3;
  const selected: Array<{path:string;size:number}> = [];
  let budget = MAX_SNAPSHOT_BYTES;
  for (const file of files.filter(f => isLargeImageDeliverable(f.path)).sort((a,b) => priority(a.path)-priority(b.path) || b.path.localeCompare(a.path))) {
    if (/mosaic\.(png|jpe?g)$/i.test(file.path)) continue;
    if (file.size <= budget) {selected.push(file);budget -= file.size;}
  }
  return selected;
}

function downloadLargeImagePreviews(envId:string, files:Array<{path:string;size:number}>): Promise<TarEntry[]> {
  const key = `${envId}:large-preview`;
  const existing = inflightDownloads.get(key);
  if (existing) return existing;
  const promise = downloadOutputFiles(envId,selectLargeImageDownloads(files)).finally(() => inflightDownloads.delete(key));
  inflightDownloads.set(key,promise);
  return promise;
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
  const large = useStore.getState().sessions[sessionId]?.agentMode === "large-image";
  const metadata = large ? (await listOutputFiles(envId)).filter(f => isLargeImageDeliverable(f.path)) : [];
  let downloaded: TarEntry[];
  let partial: PartialOutputError | undefined;
  try { downloaded = large ? await downloadLargeImagePreviews(envId,metadata) : await downloadSnapshot(envId, useStore.getState().sessions[sessionId]?.agentMode === "object3d"); }
  catch(error) {
    if (!(error instanceof PartialOutputError)) throw error;
    downloaded = error.entries; partial = error;
  }
  const entries = outputEntries(downloaded);
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
    const mediaId = existing?.mediaId ?? makeMediaId(sessionId, `env-${normalized.replace(/[^a-z0-9.-]/gi, "_")}-${fingerprint.split("@").at(-1)}`);
    if (!existing || !seen.has(fingerprint)) {
      await putMedia(mediaId, sessionId, new Blob([entry.data], { type: mime }), mime);
    }
    const record: OutputFileRecord = {
      fingerprint,
      environmentId: envId,
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

  if (partial) for (const previous of session.envFiles ?? []) {
    if (partial.paths.includes(previous.path) && !nextFiles.some(file=>file.path===previous.path)) nextFiles.push(previous);
  }
  if (large) {
    const downloaded = new Set(entries.map((entry)=>normalizeOutputPath(entry.name)));
    for (const file of metadata) if (!downloaded.has(file.path) && !nextFiles.some(record=>record.path===file.path)) {
      const {kind,mime} = classify(file.path);
      nextFiles.push({ fingerprint: `${file.path}@${file.size}`, path:file.path, label:outputLabel(file.path), kind, mimeType:mime,
        mediaId:`remote:${envId}:${file.path}`, size:file.size, syncedAt:existingByFingerprint.get(`${file.path}@${file.size}`)?.syncedAt ?? now, remoteOnly:true, environmentId:envId });
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
  if (partial) throw new FriendlyError('bad-request', `Valid output files were kept. ${partial.message}`);
  return fresh;
}
