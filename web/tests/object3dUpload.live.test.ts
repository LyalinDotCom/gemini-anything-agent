import { test, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { ai } from "../src/gemini/client";
import { prepareObject3dPhotos } from "../src/gemini/object3dInputs";
const enabled = !!process.env.GEMINI_API_KEY && !!process.env.OBJECT3D_LIVE_PHOTO;
test.skipIf(!enabled)("original photo reaches the private Files API with matching bytes and hash", async () => {
  const original = readFileSync(process.env.OBJECT3D_LIVE_PHOTO!);
  const prepared = await prepareObject3dPhotos([{ type: "image", data: original.toString("base64"), mime_type: "image/jpeg" }]);
  try {
    const reference = prepared.photos[0];
    expect(reference.fileName).toMatch(/^files\//);
    expect(reference.sizeBytes).toBe(original.length);
    expect(reference.sha256).toBe(createHash("sha256").update(original).digest("hex"));
    const metadata = await ai().files.get({ name: reference.fileName });
    expect(Number(metadata.sizeBytes)).toBe(original.length);
    expect(String(metadata.state)).toBe("ACTIVE");
    writeFileSync("../outputs/object3d-live/upload-roundtrip.json", JSON.stringify(reference, null, 2));
  } finally {
    for (const photo of prepared.photos) await ai().files.delete({ name: photo.fileName }).catch(() => {});
    await ai().environments.delete(prepared.environmentId).catch(() => {});
  }
}, 180_000);
