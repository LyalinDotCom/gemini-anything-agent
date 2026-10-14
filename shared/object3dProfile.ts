/** Shared 3D View context; discover CLI capabilities at runtime. */
export const OBJECT3D_AGENT_ID = "gai-object3d-v1";
export const OBJECT3D_VIDEO_MODEL = "gemini-omni-1.1-flash";
export const OBJECT3D_INVOCATION = [
  "Act as a photographic 3D View specialist. Read `/.agents/skills/photo-to-3d/SKILL.md` before starting.",
  "Preserve photographic identity, pose, faces, hands, fur, clothing, and contact. Create a full-circle photographic view object from Gemini-rendered views.",
  `Generate all new visual views through the official Gemini API CLI inside this managed Linux agent. For video use ${OBJECT3D_VIDEO_MODEL} at the highest supported resolution. Prioritize quality over cost and never silently downgrade.`,
  "Native libraries and Blender may process existing images only. No third-party hosted 3D services or alternative generators.",
  "Validate the actual orbit: front, one profile, back, the OPPOSITE profile, front. A front-to-back-to-front reversal is NOT 360 degrees. Do not label evenly timed video frames as evenly spaced angles. Require an inspected angle/coverage manifest before packaging. Retain photo textures and real alpha, deliver a packed Blender scene and self-contained GLB. Disclose generated unseen sides as inferred."
].join("\n");

// Keep old persisted selections readable; every selection now resolves to 3D View.
export type Object3dMethod = "compare" | "cutout" | "views";
export const OBJECT3D_METHODS = [{
  id: "views" as Object3dMethod, label: "3D View",
  description: "A complete turn through Gemini-generated photographic views, packaged in Blender.",
  instruction: "Create only the 3D View under views/. Validate front → first profile → back → opposite profile → front, with monotonic inspected angles and no reversal. Select frames by observed angle, not video time. If the video retraces one side, generate missing explicit-angle photographs with Gemini and inspect their orientation, identity and pose before packaging. Never mirror an existing side. Use the mounted native helpers with --coverage to produce object.glb, object.blend, preview.png, motion.mp4 and photo-object.json."
}];
export function object3dMethodInstruction(_method: unknown): string {
  return `Selected experience: 3D View. ${OBJECT3D_METHODS[0].instruction}`;
}
