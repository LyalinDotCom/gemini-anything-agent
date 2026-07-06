// Environment snapshot → client. The ONLY way media leaves the container:
// GET /files/environment-{envId}:download (a ustar tar, verified live incl. browser
// CORS), parse client-side, import new /workspace/output files into IndexedDB.
import { useStore } from "../state/store";
import type { ContentPart } from "../state/types";
import { mediaId as makeMediaId, putMedia } from "../storage/messages";
import { parseTar, type TarEntry } from "../utils/tar";
import { uid } from "../utils/id";
import { resolveApiKey } from "./client";
import { FriendlyError, toFriendly } from "./errors";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_SNAPSHOT_BYTES = 100 * 1024 * 1024;
const SEEN_CAP = 400;

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

function classify(name: string): { kind: "image" | "audio" | "video" | "file"; mime: string } {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_KINDS[ext] ?? { kind: "file", mime: "application/octet-stream" };
}

// One-downloader model: concurrent callers (post-turn sync + the Files panel)
// share a single in-flight snapshot fetch per environment.
const inflightDownloads = new Map<string, Promise<TarEntry[]>>();

export function downloadSnapshot(envId: string): Promise<TarEntry[]> {
  const existing = inflightDownloads.get(envId);
  if (existing) return existing;
  const promise = (async () => {
    const key = resolveApiKey();
    if (!key) throw new FriendlyError("no-key", "No Gemini API key set.");
    const resp = await fetch(`${API_BASE}/files/environment-${envId}:download?alt=media`, {
      headers: { "x-goog-api-key": key },
    });
    if (!resp.ok) {
      throw toFriendly(new Error(`API error (${resp.status}) downloading environment snapshot`));
    }
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > MAX_SNAPSHOT_BYTES) {
      throw new FriendlyError("bad-request", "Environment snapshot is too large to sync (>100MB).");
    }
    return parseTar(buf);
  })().finally(() => inflightDownloads.delete(envId));
  inflightDownloads.set(envId, promise);
  return promise;
}

export interface SyncedFile {
  path: string;
  kind: "image" | "audio" | "video" | "file";
  mediaId: string;
  mimeType: string;
  size: number;
}

/** Import files under output/ that we haven't seen before into IDB media storage. */
export async function syncOutputMedia(sessionId: string, envId: string): Promise<SyncedFile[]> {
  const entries = await downloadSnapshot(envId);
  const store = useStore.getState();
  const session = store.sessions[sessionId];
  if (!session) return [];
  const seen = new Set(session.envSeen ?? []);
  const fresh: SyncedFile[] = [];

  for (const entry of entries) {
    const normalized = entry.name.replace(/^\/+/, "");
    if (!normalized.startsWith("workspace/output/")) continue;
    const fingerprint = `${normalized}@${entry.size}`;
    if (seen.has(fingerprint) || entry.size === 0) continue;
    const { kind, mime } = classify(normalized);
    const id = makeMediaId(sessionId, `env-${normalized.replace(/[^a-z0-9.-]/gi, "_")}-${entry.size}`);
    const bytes = new Uint8Array(entry.data);
    await putMedia(id, sessionId, new Blob([bytes.buffer as ArrayBuffer], { type: mime }), mime);
    seen.add(fingerprint);
    fresh.push({ path: normalized, kind, mediaId: id, mimeType: mime, size: entry.size });
  }

  if (fresh.length > 0) {
    useStore.getState().patchSession(sessionId, { envSeen: [...seen].slice(-SEEN_CAP) });
  }
  return fresh;
}

export function syncedFilesToParts(files: SyncedFile[]): ContentPart[] {
  const parts: ContentPart[] = [];
  for (const f of files) {
    const label = f.path.replace(/^workspace\/output\//, "");
    if (f.kind === "image") {
      parts.push({ kind: "image", id: uid(), mediaId: f.mediaId, mimeType: f.mimeType, origin: "agent", prompt: label });
    } else if (f.kind === "audio") {
      parts.push({ kind: "audio", id: uid(), mediaId: f.mediaId, mimeType: f.mimeType, label });
    } else if (f.kind === "video") {
      parts.push({ kind: "video", id: uid(), mediaId: f.mediaId, mimeType: f.mimeType, label });
    } else {
      parts.push({ kind: "file", id: uid(), mediaId: f.mediaId, mimeType: f.mimeType, label });
    }
  }
  return parts;
}
