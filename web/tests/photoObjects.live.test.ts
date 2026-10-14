import { afterAll, expect, test } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureAgent, deleteAgent } from "../src/gemini/agents";
import { ai } from "../src/gemini/client";
import { downloadSnapshot } from "../src/gemini/envFiles";
import { buildInteractionParams } from "../src/gemini/interactionParams";
import { blocksFromInteraction } from "../src/gemini/streamAdapter";
import { OBJECT3D_INVOCATION, object3dMethodInstruction } from "../../shared/object3dProfile";
import { object3dPhotoContext } from "../../shared/object3dInputs";
import { prepareObject3dPhotos } from "../src/gemini/object3dInputs";
import { uniqueAgentId } from "./helpers";
const agentId = uniqueAgentId().replace("companion", "photo-object");
let interactionId = "";
const photoPath = process.env.PHOTO_OBJECT_LIVE_PHOTO;
const enabled = Boolean(photoPath && process.env.GEMINI_API_KEY);
afterAll(async () => {
  if (!enabled) return;
  if (interactionId) await ai().interactions.delete(interactionId).catch(() => undefined);
  await deleteAgent(agentId).catch(() => undefined);
});
function gltfDocument(data: Uint8Array) {
  expect(new TextDecoder().decode(data.slice(0, 4))).toBe("glTF");
  const length = new DataView(data.buffer, data.byteOffset).getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(data.slice(20, 20 + length)));
}
test.skipIf(!enabled)("managed Linux agent generates a validated complete 3D View through Gemini and packs Blender + textured GLB", async () => {
  const photo = readFileSync(resolve(photoPath!));
  const parts = [{ type: "image", mime_type: "image/jpeg", data: photo.toString("base64") }];
  const agent = await ensureAgent(agentId, null, true);
  expect(agent.degraded).toBe(false);
  const prepared = await prepareObject3dPhotos(parts);
  const started = await ai().interactions.create(buildInteractionParams({
    agent: agentId,
    input: [...parts, { type: "text", text: [
      "Create the complete 3D View of this exact person holding the cat, completely inside this managed Linux agent.",
      "Use the supplied verified Files API reference as actual CLI image input. Generate one high-resolution isolated photo, preserving their identity, complete pose, clothing, hands and cat. Solid contrasting background, portrait framing, generous margins.",
      "Use the mounted new photo-object helpers, never the old visual-hull helper. Create only views/ under /workspace/output/photo-objects/live-test.",
      "For views, generate a complete monotonic 360-degree rigid turntable rotation with a fixed camera: front at 0%, first profile 25%, back 50%, OPPOSITE profile 75%, front 100%. Never reverse or rewind. It MUST show both opposite sides. Reject front-to-back-to-front along the same side. Generate a full rigid 360 camera orbit with the selected Omni model, 10 seconds, portrait 9:16, highest supported 4k resolution. Discover CLI schema rather than guessing flags. Preserve operation IDs and resume long generations.",
      "Inspect a whole-video contact sheet. Select 32 views by observed angle, not time, and write the required --coverage JSON with distinct opposite-profile evidence. If a video still retraces after one retry, generate missing explicit-angle photographs through Gemini. Prepare their textures at maximum 1080 pixels. Run the mounted Blender helper at 768 preview resolution. Encode motion.mp4 from its render frames in views/, then remove those intermediate render frames from final output. Leave all original extracted frames and texture preparation outside /workspace/output.",
      "Copy the generated reference as isolated-reference.jpg and source video as reference-orbit.mp4 at the run root. Preserve true photo textures and alpha.",
      "Reopen the saved .blend in a fresh Blender process and render verification.png. Save live-validation.json with cli_version, blender_version, views_reopened, full_circle_verified, opposite_profiles_verified, and generated_in_managed_agent true.",
      "Inspect preview images. Prioritize photographic faces and fur; report actual failure plainly instead of substituting the distorted old mesh or a third-party service."
    ].join(" ") }],
    systemInstruction: [OBJECT3D_INVOCATION, object3dMethodInstruction("views"), object3dPhotoContext(prepared.photos)].join("\n"),
    environmentId: prepared.environmentId, store: true, background: true, stream: false,
  }) as never, { maxRetries: 0 }) as Record<string, unknown>;
  interactionId = String(started.id);
  const local = resolve("../outputs/photo-object-v3/managed-web"); mkdirSync(local, { recursive: true });
  writeFileSync(`${local}/run.json`, JSON.stringify({ agentId, interactionId, environmentId: prepared.environmentId }, null, 2));
  let outcome = blocksFromInteraction(started);
  const deadline = Date.now() + 35 * 60_000;
  while (["queued", "pending", "running", "in_progress"].includes(outcome.status.toLowerCase())) {
    if (Date.now() > deadline) throw new Error("Photographic object run timed out");
    await new Promise((done) => setTimeout(done, 5000));
    outcome = blocksFromInteraction(await ai().interactions.get(interactionId) as Record<string, unknown>);
  }
  writeFileSync(`${local}/outcome.json`, JSON.stringify(outcome, null, 2));
  expect(outcome.status).toBe("completed");
  const entries = await downloadSnapshot(outcome.environmentId, true);
  const artifact = (name: string) => entries.find((entry) => entry.name.endsWith(`/photo-objects/live-test/${name}`));
  for (const mode of ["views"]) {
    mkdirSync(`${local}/${mode}`, { recursive: true });
    for (const name of ["object.blend", "object.glb", "preview.png", "motion.mp4", "photo-object.json", "verification.png"]) {
      const entry = artifact(`${mode}/${name}`); expect(entry, `${mode}/${name} missing`).toBeTruthy();
      expect(entry!.data.length).toBeGreaterThan(20); writeFileSync(`${local}/${mode}/${name}`, entry!.data);
    }
    const gltf = gltfDocument(artifact(`${mode}/object.glb`)!.data);
    expect(gltf.images.length).toBe(32);
    expect(gltf.images.every((image: { bufferView?: number }) => typeof image.bufferView === "number")).toBe(true);
    expect(gltf.materials.every((material: { alphaMode?: string; extensions?: object; pbrMetallicRoughness?: { baseColorTexture?: object } }) => material.alphaMode === "BLEND" && material.extensions && "KHR_materials_unlit" in material.extensions && material.pbrMetallicRoughness?.baseColorTexture)).toBe(true);
    expect(gltf.nodes.filter((node: { extras?: { photo_object_mode?: string } }) => node.extras?.photo_object_mode === mode).length).toBe(32);
    expect(new TextDecoder().decode(artifact(`${mode}/object.blend`)!.data.slice(0,7))).toBe("BLENDER");
    const report = JSON.parse(new TextDecoder().decode(artifact(`${mode}/photo-object.json`)!.data));
    expect(report.coverage.evidence.opposite_profile).toBeTruthy(); expect(report.status).toBe("completed"); expect(report.photo_object_mode).toBe(mode);
    expect(report.textures.every((texture: { transparent_pixel_fraction: number }) => texture.transparent_pixel_fraction > .1)).toBe(true);
  }
  for (const name of ["isolated-reference.jpg", "reference-orbit.mp4", "live-validation.json"]) {
    const entry = artifact(name); expect(entry).toBeTruthy(); writeFileSync(`${local}/${name}`, entry!.data);
  }
  const validation = JSON.parse(new TextDecoder().decode(artifact("live-validation.json")!.data));
  expect(validation.cli_version).toContain("0.4.2"); expect(validation.views_reopened).toBe(true); expect(validation.full_circle_verified).toBe(true); expect(validation.opposite_profiles_verified).toBe(true); expect(validation.generated_in_managed_agent).toBe(true);
}, 40 * 60_000);
