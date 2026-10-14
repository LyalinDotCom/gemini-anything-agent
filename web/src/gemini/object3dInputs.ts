import { object3dPhotos, type Object3dPhotoReference } from "../../../shared/object3dInputs";
import { ai, resolveApiKey } from "./client";
import { buildEnvSources } from "./envSources";
import type { TurnParams } from "./interactionParams";

/** The stable Files API preserves bytes; experimental environment uploads do not. */
export async function prepareObject3dPhotos(
  input: unknown,
  environmentId?: string,
  network?: NonNullable<TurnParams["environmentConfig"]>["network"],
): Promise<{ environmentId: string; photos: Object3dPhotoReference[]; sources: ReturnType<typeof buildEnvSources> }> {
  const photos: Object3dPhotoReference[] = [];
  const sources: ReturnType<typeof buildEnvSources> = [];
  for (const photo of object3dPhotos(input)) {
    const bytes = Uint8Array.from(atob(photo.data), (character) => character.charCodeAt(0));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const uploaded = await ai().files.upload({
      file: new Blob([bytes], { type: photo.mimeType }),
      config: { mimeType: photo.mimeType, displayName: photo.target.split("/").pop()! },
    });
    if (!uploaded.name) throw new Error("Photo upload returned no Files API reference.");
    let file = uploaded;
    const deadline = Date.now() + 120_000;
    while (String(file.state) === "PROCESSING") {
      if (Date.now() > deadline) throw new Error("Photo upload is still processing. Try again shortly.");
      await new Promise((done) => setTimeout(done, 1000));
      file = await ai().files.get({ name: uploaded.name });
    }
    // API versions return either a base64-encoded hex digest or a base64 binary digest.
    const encodedHash = file.sha256Hash ? atob(file.sha256Hash) : "";
    const returnedHash = /^[a-f0-9]{64}$/i.test(encodedHash)
      ? encodedHash.toLowerCase()
      : Array.from(encodedHash, (character) => character.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    if (String(file.state) !== "ACTIVE" || Number(file.sizeBytes) !== bytes.length || returnedHash !== sha256 || !file.uri) {
      await ai().files.delete({ name: uploaded.name }).catch(() => undefined);
      throw new Error("Original photo transfer verification failed. The 3D run was not started.");
    }
    const reference = { target: photo.target, mimeType: photo.mimeType, fileName: uploaded.name, fileUri: file.uri, sizeBytes: bytes.length, sha256 };
    photos.push(reference);
    sources.push({ type: "inline", target: `${photo.target}.json`, content: JSON.stringify(reference) });
  }
  let id = environmentId;
  if (!id) {
    const key = resolveApiKey();
    if (!key) throw new Error("No Gemini API key set.");
    const environment = await ai().environments.create({ sources: [...buildEnvSources(key), ...sources], ...(network ? { network } : {}) }, { maxRetries: 0 });
    id = environment.id.replace(/^environments\//, "");
    return { environmentId: id, photos, sources: [] };
  }
  // Reused environments cannot reliably accept updated inline sources. The
  // invocation also carries the complete provenance, so no filesystem upload is needed.
  return { environmentId: id, photos, sources: [] };
}
