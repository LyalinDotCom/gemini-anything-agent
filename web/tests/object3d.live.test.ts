import { afterAll, expect, test } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureAgent, deleteAgent } from "../src/gemini/agents";
import { ai } from "../src/gemini/client";
import { downloadSnapshot } from "../src/gemini/envFiles";
import { buildInteractionParams } from "../src/gemini/interactionParams";
import { blocksFromInteraction } from "../src/gemini/streamAdapter";
import { OBJECT3D_INVOCATION } from "../../shared/object3dProfile";
import { object3dPhotoContext } from "../../shared/object3dInputs";
import { prepareObject3dPhotos } from "../src/gemini/object3dInputs";
import { uniqueAgentId } from "./helpers";

const agentId = uniqueAgentId().replace("companion", "object3d");
let interactionId = "";
const photoPath = process.env.OBJECT3D_LIVE_PHOTO;
const enabled = Boolean(photoPath && process.env.GEMINI_API_KEY);

afterAll(async () => {
  if (!enabled) return;
  if (interactionId) await ai().interactions.delete(interactionId).catch(() => undefined);
  await deleteAgent(agentId).catch(() => undefined);
});

test.skipIf(!enabled)("3D Object web profile creates a real mesh, Blender scene, and rendered turntable in Linux", async () => {
  const photo = readFileSync(resolve(photoPath!));
  const parts = [{ type: "image" as const, mime_type: "image/jpeg", data: photo.toString("base64") }];
  const agent = await ensureAgent(agentId, null, true);
  expect(agent.degraded).toBe(false);
  const prepared = await prepareObject3dPhotos(parts);
  const started = await ai().interactions.create(buildInteractionParams({
    agent: agentId,
    input: [...parts, { type: "text", text: [
      "Create an actual editable 3D object from the attached rocket photo using the mounted photo-to-3d skill.",
      "Run everything inside this Linux sandbox: CLI installation, generated full orbit, reconstruction, Blender, and verification.",
      "Use the verified original Files API reference as CLI image input to create a local isolated photo, then use that derivative as the video input. Finish all steps autonomously, including targeted orbit regeneration if it fails consistency checks.",
      "Use 32 orbit views, a 128 voxel grid, and 24 Blender turntable frames at 512 pixels.",
      "Use /workspace/output/3d/live-test for this run. Copy final deliverables to that directory as object.blend, object.glb, preview.png, turntable.mp4, reconstruction.json and reference-orbit.mp4.",
      "Keep intermediate frames and caches outside /workspace/output. Reopen the saved Blender project and render a verification image.",
      "Write live-validation.json with cli_version, blender_version, mesh_vertices, mesh_faces, reopened_blend (boolean), and photo_used_as_reference (boolean).",
      "Report failures plainly; do not substitute a flat plane or a reference video for the mesh."
    ].join(" ") }],
    systemInstruction: `${OBJECT3D_INVOCATION}\n${object3dPhotoContext(prepared.photos)}`,
    environmentId: prepared.environmentId,
    seedSources: prepared.sources,
    store: true, background: true, stream: false,
  }) as never, { maxRetries: 0 }) as Record<string, unknown>;
  interactionId = String(started.id ?? "");
  expect(interactionId).not.toBe("");
  const local = resolve("../outputs/object3d-live/managed-web");
  mkdirSync(local, { recursive: true });
  writeFileSync(`${local}/run.json`, JSON.stringify({ agentId, interactionId }, null, 2));
  let outcome = blocksFromInteraction(started);
  let progressAt = 0;
  const deadline = Date.now() + 25 * 60_000;
  while (["queued", "pending", "running", "in_progress"].includes(outcome.status.toLowerCase())) {
    if (Date.now() > deadline) throw new Error(`3D Object live test timed out: ${interactionId}`);
    await new Promise((done) => setTimeout(done, 4_000));
    outcome = blocksFromInteraction(await ai().interactions.get(interactionId) as Record<string, unknown>);
    if (Date.now() - progressAt > 30_000) {
      console.log("3D Object live:", outcome.status, "blocks:", outcome.blocks.length);
      progressAt = Date.now();
    }
  }
  writeFileSync(`${local}/outcome.json`, JSON.stringify(outcome, null, 2));
  expect(outcome.status).toBe("completed");
  expect(outcome.environmentId).toBeTruthy();
  const entries = await downloadSnapshot(outcome.environmentId);
  const artifact = (name: string) => entries.find((entry) => entry.name.endsWith(`/3d/live-test/${name}`));
  for (const name of ["object.blend", "object.glb", "preview.png", "turntable.mp4", "reconstruction.json", "reference-orbit.mp4", "live-validation.json"]) {
    const entry = artifact(name);
    expect(entry, `${name} missing; inspect ${local}/outcome.json`).toBeTruthy();
    expect(entry!.data.byteLength).toBeGreaterThan(20);
    writeFileSync(`${local}/${name}`, entry!.data);
  }
  expect(new TextDecoder().decode(artifact("object.glb")!.data.slice(0, 4))).toBe("glTF");
  expect(new TextDecoder().decode(artifact("object.blend")!.data.slice(0, 7))).toBe("BLENDER");
  expect(artifact("preview.png")!.data.slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  const validation = JSON.parse(new TextDecoder().decode(artifact("live-validation.json")!.data));
  expect(validation.cli_version).toContain("0.4.2");
  expect(validation.mesh_vertices).toBeGreaterThan(100);
  expect(validation.mesh_faces).toBeGreaterThan(100);
  expect(validation.reopened_blend).toBe(true);
  expect(validation.photo_used_as_reference).toBe(true);
  const report = JSON.parse(new TextDecoder().decode(artifact("reconstruction.json")!.data));
  expect(report.status).toBe("completed");
  expect(report.watertight).toBe(true);
}, 30 * 60_000);
