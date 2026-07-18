import { contentFingerprint } from "../utils/contentFingerprint";
import { outputSegments } from "../utils/outputPaths";
import type { TarEntry } from "../utils/tar";
import { idbDelete, idbGet, idbPut } from "./db";
import { useStore } from "../state/store";

const PERMISSION = { mode: "readwrite" as const };

// Written-state per session (relative path → content fingerprint). The caller
// passes the FULL visible entry list after every turn; without this, every turn
// rewrote every previously synced file. In-memory only — a reload backfills once.
const writtenBySession = new Map<string, Map<string, string>>();

export interface ProjectSyncResult {
  name: string;
  written: number;
  skipped: number;
  permission: PermissionState;
  metadataWritten: boolean;
}

async function writeBytes(directory: FileSystemDirectoryHandle, name: string, data: BlobPart): Promise<void> {
  const file = await directory.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(new Blob([data]));
  } finally {
    await writable.close();
  }
}

async function writeConversationMetadata(root: FileSystemDirectoryHandle, sessionId: string): Promise<boolean> {
  const state = useStore.getState();
  const session = state.sessions[sessionId];
  if (!session) return false;
  const messages = state.messages[sessionId] ?? [];
  const metadata = await root.getDirectoryHandle(".gemini-anything", { create: true });
  await writeBytes(metadata, "conversation.json", JSON.stringify({ session, messages }, null, 2));
  const markdown = messages.map((message) => {
    const body = message.parts.flatMap((part) => {
      if (part.kind === "text" || part.kind === "thought") return [part.text];
      if (part.kind === "tool") return [`[${part.activity.status}] ${part.activity.label}`];
      if ("label" in part) return [`[artifact] ${part.label}`];
      return [];
    }).join("\n\n");
    return `## ${message.role === "user" ? "User" : "Assistant"}\n\n${body}`;
  }).join("\n\n");
  await writeBytes(metadata, "conversation.md", `# ${session.title}\n\n${markdown}\n`);
  return true;
}

export function supportsLocalProjects(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function getProjectHandle(sessionId: string): Promise<FileSystemDirectoryHandle | null> {
  const record = await idbGet<{ id: string; handle: FileSystemDirectoryHandle }>("projectHandles", sessionId);
  return record?.handle ?? null;
}

export async function linkProjectFolder(sessionId: string): Promise<FileSystemDirectoryHandle> {
  if (!window.showDirectoryPicker) throw new Error("Folder linking is not supported by this browser.");
  const handle = await window.showDirectoryPicker({ id: `gemini-anything-${sessionId}`, mode: "readwrite" });
  await idbPut("projectHandles", { id: sessionId, handle });
  // A freshly linked folder needs the full backfill regardless of prior syncs.
  writtenBySession.delete(sessionId);
  return handle;
}

export async function unlinkProjectFolder(sessionId: string): Promise<void> {
  await idbDelete("projectHandles", sessionId);
  writtenBySession.delete(sessionId);
}

async function permissionFor(handle: FileSystemDirectoryHandle, request: boolean): Promise<PermissionState> {
  const current = await handle.queryPermission(PERMISSION);
  if (current === "granted" || !request) return current;
  return handle.requestPermission(PERMISSION);
}

export async function syncEntriesToProject(
  sessionId: string,
  entries: TarEntry[],
  requestPermission: boolean,
): Promise<ProjectSyncResult | null> {
  const root = await getProjectHandle(sessionId);
  if (!root) return null;
  const permission = await permissionFor(root, requestPermission);
  if (permission !== "granted") return { name: root.name, written: 0, skipped: entries.length, permission, metadataWritten: false };

  const writtenPaths = writtenBySession.get(sessionId) ?? new Map<string, string>();
  writtenBySession.set(sessionId, writtenPaths);
  const directories = new Map<string, FileSystemDirectoryHandle>();
  let written = 0;
  let skipped = 0;
  for (const entry of entries) {
    const segments = outputSegments(entry.name);
    if (!segments || entry.size <= 0) {
      skipped++;
      continue;
    }
    const relPath = segments.join("/");
    const fingerprint = await contentFingerprint(relPath, entry.data);
    if (writtenPaths.get(relPath) === fingerprint) {
      skipped++;
      continue;
    }
    let directory = root;
    let prefix = "";
    for (const segment of segments.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      const cached = directories.get(prefix);
      if (cached) {
        directory = cached;
      } else {
        directory = await directory.getDirectoryHandle(segment, { create: true });
        directories.set(prefix, directory);
      }
    }
    await writeBytes(directory, segments.at(-1)!, entry.data);
    writtenPaths.set(relPath, fingerprint);
    written++;
  }
  const metadataWritten = await writeConversationMetadata(root, sessionId);
  return { name: root.name, written, skipped, permission, metadataWritten };
}
