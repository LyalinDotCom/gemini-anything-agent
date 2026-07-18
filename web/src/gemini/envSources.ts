// The agent payload is SHARED with the Electron app: everything comes from the
// repo-root agents/ folder — the single source of truth for both UIs. Edit those
// files to tune the agent everywhere; because the agent's identity is a fingerprint
// of the whole payload, any edit automatically recreates every agent on its next
// message. No versions to bump, nothing else to touch.
//
// agents/AGENTS.md                       → /.agents/AGENTS.md   (persona & rules)
// agents/bin/gai                         → /.agents/bin/gai     (launcher → npx -y @lyalindotcom/gai)
// agents/bin/browser                     → /.agents/bin/browser (launcher → npx -y @playwright/cli)
// agents/skills/gemini-anything/SKILL.md → /.agents/skills/gemini-anything/SKILL.md
// agents/skills/browser-testing/SKILL.md  → /.agents/skills/browser-testing/SKILL.md
// (the user's key)                       → /.env                (GEMINI_API_KEY=…; sourced by the launcher)
//
// The key ships as /.env — the same mechanism the Electron app uses — so the shared
// launcher and instruction files work byte-identically under either UI.
//
// There is deliberately NO agent-level system_instruction: the base agent auto-reads
// AGENTS.md (additive, undisplaceable), while agent-level and request-level
// system_instruction share ONE slot — any per-request injection would silently knock
// an agent-level prompt out. The request-level slot carries only fresh per-call
// context (see controller). All media capability comes from the PUBLISHED CLI
// @lyalindotcom/gai via the shared launcher — never a local reimplementation
// (hard rule; see the repo-root AGENTS.md). Browser automation independently
// comes from the published Playwright agent CLI through its own launcher.
import agentsMd from "../../../agents/AGENTS.md?raw";
import browserLauncher from "../../../agents/bin/browser?raw";
import gaiLauncher from "../../../agents/bin/gai?raw";
import browserSkill from "../../../agents/skills/browser-testing/SKILL.md?raw";
import geminiSkill from "../../../agents/skills/gemini-anything/SKILL.md?raw";
import type { InlineSource } from "./interactionParams";

export function buildEnvSources(apiKey: string): InlineSource[] {
  return [
    { type: "inline", target: "/.agents/AGENTS.md", content: agentsMd },
    { type: "inline", target: "/.env", content: `GEMINI_API_KEY=${apiKey}\n` },
    { type: "inline", target: "/.agents/bin/gai", content: gaiLauncher },
    { type: "inline", target: "/.agents/skills/gemini-anything/SKILL.md", content: geminiSkill },
    { type: "inline", target: "/.agents/bin/browser", content: browserLauncher },
    { type: "inline", target: "/.agents/skills/browser-testing/SKILL.md", content: browserSkill },
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
