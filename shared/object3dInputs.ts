/** Preserve original bytes; media commands reference the private Files API upload. */
export function object3dPhotos(input: unknown): Array<{ target: string; mimeType: string; data: string }> {
  if (!Array.isArray(input)) return [];
  return input.flatMap((part, index) => {
    if (part?.type !== "image" || typeof part.data !== "string" || !part.data) return [];
    let hash = 0x811c9dc5;
    for (let i = 0; i < part.data.length; i++) {
      hash = Math.imul(hash ^ part.data.charCodeAt(i), 0x01000193) >>> 0;
    }
    const mimeType = String(part.mime_type ?? "image/jpeg");
    const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[mimeType] ?? "bin";
    return [{ target: `workspace/input/photo3d-${hash.toString(16)}-${index}.${extension}`, mimeType, data: part.data }];
  });
}

export interface Object3dPhotoReference {
  target: string;
  mimeType: string;
  fileName: string;
  fileUri: string;
  sizeBytes: number;
  sha256: string;
}

export function object3dPhotoContext(photos: Object3dPhotoReference[]): string {
  if (!photos.length) return "";
  return [
    "The exact original photos were uploaded privately to the Gemini Files API and verified by byte count and SHA-256. They are available as CLI media input references:",
    ...photos.map((photo) => `- ${photo.fileName} (${photo.mimeType}, ${photo.sizeBytes} bytes, SHA-256 ${photo.sha256}); preserve this provenance at /${photo.target}.json: ${JSON.stringify(photo)}`),
    "Use these Files API references directly as the official CLI image input. First create an isolated foreground reference locally, preserving the original subject. Use that local derivative for the selected photographic cutout and/or angle-view method. The original is not a sandbox binary file; do not attempt the experimental sandbox upload route.",
    "If the CLI cannot consume the reference, stop promptly and report the error. Do not investigate runtime internals or inspect environment variables. Never recreate the image from a description."
  ].join("\n");
}
