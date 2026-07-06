// Media helpers (Spark utils/media.ts patterns): client-side image compression before
// upload (1280px max edge, JPEG q=0.82 — ~3MB photos become ~200KB) and data-url math.

export function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

export function dataUrlMime(dataUrl: string): string {
  const m = dataUrl.match(/^data:([^;,]+)/);
  return m?.[1] ?? "application/octet-stream";
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function fileToCompressedDataUrl(file: File, maxEdge = 1280, quality = 0.82): Promise<string> {
  const original = await blobToDataUrl(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image decode failed"));
      el.src = original;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    if (scale >= 1 && file.size < 400_000) return original;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return original; // non-decodable (e.g. exotic format): send as-is
  }
}
