import type { Message } from "../state/types";
import { idbDelete, idbDeleteMediaForSession, idbGet, idbPut } from "./db";

export async function loadTranscript(sessionId: string): Promise<Message[]> {
  const rec = await idbGet<{ sessionId: string; messages: Message[] }>("messages", sessionId);
  return rec?.messages ?? [];
}

export async function saveTranscript(sessionId: string, messages: Message[]): Promise<void> {
  await idbPut("messages", { sessionId, messages });
}

export async function deleteSessionData(sessionId: string): Promise<void> {
  await idbDelete("messages", sessionId);
  await idbDelete("projectHandles", sessionId);
  await idbDeleteMediaForSession(sessionId);
  for (const [id, url] of urlCache) {
    if (id.startsWith(`${sessionId}:`)) {
      URL.revokeObjectURL(url);
      urlCache.delete(id);
    }
  }
}

// ---- media ----------------------------------------------------------------

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Media ids are namespaced by session so deletes can revoke object URLs too. */
export function mediaId(sessionId: string, partId: string): string {
  return `${sessionId}:${partId}`;
}

export async function putMedia(id: string, sessionId: string, blob: Blob, mimeType: string): Promise<void> {
  await idbPut("media", { id, sessionId, blob, mimeType });
}

const urlCache = new Map<string, string>();

export async function getMediaUrl(id: string): Promise<string | null> {
  const cached = urlCache.get(id);
  if (cached) return cached;
  const rec = await idbGet<{ id: string; blob: Blob }>("media", id);
  if (!rec?.blob) return null;
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(id, url);
  return url;
}

export async function getMediaBase64(id: string): Promise<{ base64: string; mimeType: string } | null> {
  const rec = await idbGet<{ id: string; blob: Blob; mimeType: string }>("media", id);
  if (!rec?.blob) return null;
  return { base64: await blobToBase64(rec.blob), mimeType: rec.mimeType };
}
