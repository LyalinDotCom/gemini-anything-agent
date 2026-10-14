import { afterAll, expect, test } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ai } from "../src/gemini/client";
import { ensureAgent, deleteAgent } from "../src/gemini/agents";
import { downloadSnapshot } from "../src/gemini/envFiles";
import { buildInteractionParams } from "../src/gemini/interactionParams";
import { blocksFromInteraction } from "../src/gemini/streamAdapter";
import { uniqueAgentId } from "./helpers";

// Explicit verification of an existing test workspace; never regenerate its images.
const enabled = Boolean(process.env.PHOTO_OBJECT_VERIFY_RUN && process.env.GEMINI_API_KEY);
const agentId = uniqueAgentId().replace("companion", "photo-object-verify");
let interactionId = "";
let createdAgent = false;
afterAll(async () => {
  if (!enabled) return;
  if (interactionId) await ai().interactions.delete(interactionId).catch(() => undefined);
  if (createdAgent) await deleteAgent(agentId).catch(() => undefined);
});

test.skipIf(!enabled)("managed agent verifies existing photographic artifacts and repairs emission-to-unlit export when needed", async () => {
  const local = resolve("../outputs/photo-object-v2/managed-web");
  const sourceRun = JSON.parse(readFileSync(resolve(process.env.PHOTO_OBJECT_VERIFY_RUN!), "utf8"));
  const helper = readFileSync(resolve("../agents/skills/photo-to-3d/photo_object_blender.py"), "utf8");
  const patchFunction = helper.slice(helper.indexOf("def set_unlit("), helper.indexOf("\ndef main():"));
  const native = `import json, struct\nfrom pathlib import Path\n${patchFunction}\nroot = Path('/workspace/output/photo-objects/live-test')\nfor mode in ('cutout', 'views'):\n    set_unlit(root / mode / 'object.glb')\nprint('Verified photographic glTF texture mapping for both methods')\n`;
  let outcome;
  if (process.env.PHOTO_OBJECT_VERIFY_EXISTING === "1") {
    outcome = JSON.parse(readFileSync(`${local}/verification-outcome.json`, "utf8"));
  } else {
  const agent = await ensureAgent(agentId, null, true); expect(agent.degraded).toBe(false); createdAgent = true;
  const started = await ai().interactions.create(buildInteractionParams({
    agent: agentId, environmentId: sourceRun.environmentId, store: true, background: true, stream: false,
    input: `Verify the existing completed photo-object test artifacts in this same Linux environment. Do not call any image/video models, regenerate photos, or use external services. Run this native Python code to normalize Blender's emissive-texture export for unlit glTF readers:\n\n${native}\n\nBefore inspecting binaries, move /workspace/.tools/photo-to-3d to /tmp/photo-native-cache-export if present. The native dependency cache outside workspace prevents the environment-file export offset bug observed in live tests. Batch the native work into as few tool calls as possible. Reopen both saved object.blend files in a fresh Blender process, explicitly disable scene.cycles.use_denoising and all view-layer Cycles denoising (this Linux build has no OpenImageDenoiser), save the scenes with that portable setting and render verification.png in each folder. Preserve all existing outputs, make sure each method has object.glb, object.blend, preview.png, motion.mp4, photo-object.json and verification.png, plus run-root isolated-reference.jpg, reference-orbit.mp4 and live-validation.json. Remove only intermediate rendered frames and Blender backup .blend1 files from /workspace/output (keep preparation and extracted source frames outside output). Keep the recorded original generated model and resolution. Update live-validation.json with cutout_reopened and views_reopened true only after actual successful fresh-process rendering, and native_glb_verified true. Inspect both verification images and report any visual failure.`,
  }) as never, { maxRetries: 0 }) as Record<string, unknown>;
  interactionId = String(started.id);
  writeFileSync(`${local}/verification-run.json`, JSON.stringify({ agentId, interactionId, environmentId: sourceRun.environmentId }, null, 2));
  outcome = blocksFromInteraction(started);
  const deadline = Date.now() + 25 * 60_000;
  while (["queued", "pending", "running", "in_progress"].includes(outcome.status.toLowerCase())) {
    if (Date.now() > deadline) throw new Error("Native artifact verification timed out");
    await new Promise((done) => setTimeout(done, 5000));
    outcome = blocksFromInteraction(await ai().interactions.get(interactionId) as Record<string, unknown>);
  }
  writeFileSync(`${local}/verification-outcome.json`, JSON.stringify(outcome, null, 2));
  }
  expect(outcome.status).toBe("completed");
  const entries = await downloadSnapshot(outcome.environmentId, true);
  const artifact = (name: string) => entries.find((entry) => entry.name.endsWith(`/photo-objects/live-test/${name}`));
  for (const mode of ["cutout", "views"]) {
    mkdirSync(`${local}/${mode}`, { recursive: true });
    for (const name of ["object.blend", "object.glb", "preview.png", "motion.mp4", "photo-object.json", "verification.png"]) {
      const entry = artifact(`${mode}/${name}`); expect(entry, `${mode}/${name}`).toBeTruthy();
      expect(entry!.data.length).toBeGreaterThan(20); writeFileSync(`${local}/${mode}/${name}`, entry!.data);
    }
    const bytes = artifact(`${mode}/object.glb`)!.data;
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("glTF");
    const jsonLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true);
    const gltf = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + jsonLength)));
    expect(gltf.images.length).toBe(mode === "cutout" ? 1 : 32);
    expect(gltf.images.every((image: { bufferView?: number }) => typeof image.bufferView === "number")).toBe(true);
    expect(gltf.materials.every((material: { alphaMode?: string; extensions?: object; pbrMetallicRoughness?: { baseColorTexture?: object } }) => material.alphaMode === "BLEND" && material.extensions && "KHR_materials_unlit" in material.extensions && material.pbrMetallicRoughness?.baseColorTexture)).toBe(true);
    expect(gltf.nodes.filter((node: { extras?: { photo_object_mode?: string } }) => node.extras?.photo_object_mode === mode).length).toBe(mode === "cutout" ? 1 : 32);
    expect(new TextDecoder().decode(artifact(`${mode}/object.blend`)!.data.slice(0, 7))).toBe("BLENDER");
    const report = JSON.parse(new TextDecoder().decode(artifact(`${mode}/photo-object.json`)!.data));
    expect(report.status).toBe("completed"); expect(report.photo_object_mode).toBe(mode);
    expect(report.textures.every((texture: { transparent_pixel_fraction: number }) => texture.transparent_pixel_fraction > .1)).toBe(true);
  }
  for (const name of ["isolated-reference.jpg", "reference-orbit.mp4", "live-validation.json"]) {
    const entry = artifact(name); expect(entry, name).toBeTruthy(); writeFileSync(`${local}/${name}`, entry!.data);
  }
  const validation = JSON.parse(new TextDecoder().decode(artifact("live-validation.json")!.data));
  expect(validation.cli_version).toContain("0.4.2"); expect(validation.cutout_reopened).toBe(true); expect(validation.views_reopened).toBe(true); expect(validation.generated_in_managed_agent).toBe(true); expect(validation.native_glb_verified).toBe(true);
}, 30 * 60_000);
