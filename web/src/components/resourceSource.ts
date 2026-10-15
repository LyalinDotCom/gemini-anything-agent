import type { OutputFileRecord } from "../state/types";
import { getMediaUrl, putMedia } from "../storage/messages";
import { downloadOutputFile } from "../gemini/envFiles";

export async function loadResourceUrl(file: OutputFileRecord): Promise<string> {
  const cached = await getMediaUrl(file.mediaId);
  if (cached) return cached;
  if (file.remoteOnly) throw new Error("Use Files to download this full-resolution resource.");
  if (!file.environmentId) throw new Error("This resource is unavailable on this device. Check output files to restore it.");
  const entry = await downloadOutputFile(file.environmentId, file);
  await putMedia(file.mediaId, file.mediaId.split(":")[0], new Blob([entry.data], { type: file.mimeType }), file.mimeType);
  const url = await getMediaUrl(file.mediaId);
  if (!url) throw new Error("Could not restore this resource. Check output files and retry.");
  return url;
}
