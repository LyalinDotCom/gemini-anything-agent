import largeFinish from "../../../agents/skills/gigapixel-gemini-mosaic/scripts/finish.py?raw";
import seamPatch from "../../../agents/skills/gigapixel-gemini-mosaic/scripts/seam_patch.py?raw";
import largeAsset0 from "../../../agents/bin/large-image-setup?raw";
import largeAsset1 from "../../../agents/skills/gigapixel-gemini-mosaic/SKILL.md?raw";
import largeAsset2 from "../../../agents/skills/dr-seuss-world/SKILL.md?raw";
import largeAsset3 from "../../../agents/skills/dr-seuss-world/references/dr-seuss-world-rules.md?raw";
import largeAsset4 from "../../../agents/skills/gigapixel-gemini-mosaic/scripts/mosaic.py?raw";
import largeAsset5 from "../../../agents/skills/gigapixel-gemini-mosaic/scripts/qa.py?raw";
import largeAsset6 from "../../../agents/skills/gigapixel-gemini-mosaic/scripts/forensics.py?raw";
import largeAsset7 from "../../../agents/skills/gigapixel-gemini-mosaic/scripts/make_deepzoom.py?raw";
import largeAsset8 from "../../../agents/skills/gigapixel-gemini-mosaic/viewer/index.html?raw";
import largeAsset9 from "../../../agents/skills/gigapixel-gemini-mosaic/viewer/styles.txt?raw";
import largeAsset10 from "../../../agents/skills/gigapixel-gemini-mosaic/viewer/deepzoom.js?raw";
// Shared canonical payload from agents/; the browser and desktop harness
// mount identical assets. All media uses the official Gemini API CLI.
// The key is mounted separately at /.env, never included in source control.
import agentsMd from "../../../agents/AGENTS.md?raw";
import browserLauncher from "../../../agents/bin/browser?raw";
import browserSkill from "../../../agents/skills/browser-testing/SKILL.md?raw";
import geminiSkill from "../../../agents/skills/gemini-anywhere/SKILL.md?raw";
import officialCliLauncher from "../../../agents/bin/gemini-api?raw";
import object3dSetup from "../../../agents/bin/object3d-setup?raw";
import object3dSkill from "../../../agents/skills/photo-to-3d/SKILL.md?raw";
import object3dReconstruct from "../../../agents/skills/photo-to-3d/reconstruct.py?raw";
import object3dFinish from "../../../agents/skills/photo-to-3d/finish_blender.py?raw";
import photoObjectPrepare from "../../../agents/skills/photo-to-3d/prepare_photo_object.py?raw";
import photoObjectBlender from "../../../agents/skills/photo-to-3d/photo_object_blender.py?raw";
import { AGENT_ASSET_PATHS } from "../../../shared/agentAssets";
import type { InlineSource } from "./interactionParams";

const assets: Record<typeof AGENT_ASSET_PATHS[number], string> = {
  "AGENTS.md": agentsMd,
  "bin/large-image-setup": largeAsset0,
  "skills/gigapixel-gemini-mosaic/SKILL.md": largeAsset1,
  "skills/dr-seuss-world/SKILL.md": largeAsset2,
  "skills/dr-seuss-world/references/dr-seuss-world-rules.md": largeAsset3,
  "skills/gigapixel-gemini-mosaic/scripts/mosaic.py": largeAsset4,
  "skills/gigapixel-gemini-mosaic/scripts/qa.py": largeAsset5,
  "skills/gigapixel-gemini-mosaic/scripts/seam_patch.py": seamPatch,
  "skills/gigapixel-gemini-mosaic/scripts/finish.py": largeFinish,
  "skills/gigapixel-gemini-mosaic/scripts/forensics.py": largeAsset6,
  "skills/gigapixel-gemini-mosaic/scripts/make_deepzoom.py": largeAsset7,
  "skills/gigapixel-gemini-mosaic/viewer/index.html": largeAsset8,
  "skills/gigapixel-gemini-mosaic/viewer/styles.txt": largeAsset9,
  "skills/gigapixel-gemini-mosaic/viewer/deepzoom.js": largeAsset10,

  "bin/browser": browserLauncher,
  "skills/gemini-anywhere/SKILL.md": geminiSkill,
  "skills/browser-testing/SKILL.md": browserSkill,
  "bin/gemini-api": officialCliLauncher,
  "bin/object3d-setup": object3dSetup,
  "skills/photo-to-3d/SKILL.md": object3dSkill,
  "skills/photo-to-3d/reconstruct.py": object3dReconstruct,
  "skills/photo-to-3d/finish_blender.py": object3dFinish,
  "skills/photo-to-3d/prepare_photo_object.py": photoObjectPrepare,
  "skills/photo-to-3d/photo_object_blender.py": photoObjectBlender,
};

export function buildEnvSources(apiKey: string): InlineSource[] {
  return [
    ...AGENT_ASSET_PATHS.map((path) => ({ type: "inline" as const, target: `/.agents/${path}`, content: assets[path] })),
    { type: "inline", target: "/.env", content: `GEMINI_API_KEY=${apiKey}\n` },
  ];
}

/** Stable fingerprint of the payload (FNV-1a): any change → agents recreate automatically. */
export function payloadFingerprint(sources: InlineSource[]): string {
  const text = sources.map((s) => `${s.target} ${s.content}`).join("");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
