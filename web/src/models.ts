// The single registry of pinned ids. Never use "-latest" aliases (they get hot-swapped);
// never scatter model strings through the codebase. All ids verified live against the API.
export const MODELS = {
  /** Plain/default Antigravity profile and base for the two custom profiles. */
  chatAgentBase: "antigravity-preview-09-2026",
  /** Long-running research agent (background + polling/reattach). */
  deepResearch: "deep-research-preview-04-2026",
  /** Highest-effort long-running research agent. */
  deepResearchMax: "deep-research-max-preview-04-2026",
  /** Fast text model: session titles, transcription, utility calls. */
  text: "gemini-3.8-flash",
  reasoning: "gemini-4-argon",
  /** Image generation (all three known ids verified live; flash is fastest). */
  image: "gemini-nano-banana-2.1",
} as const;

/** The app-managed agent id created under the user's key on first chat. */
export const CHAT_AGENT_ID = "gai-anything-v1";
export const BROWSER_AGENT_ID = "gai-browser-v1";

export const APP_NAME = "Gemini Anything";

export const HARNESS_MODELS = [
  { id: MODELS.text, label: "Gemini 3.8 Flash" },
  { id: MODELS.reasoning, label: "Gemini 4 Argon" },
] as const;
export type HarnessModel = typeof HARNESS_MODELS[number]["id"];
export function isHarnessModel(value: unknown): value is HarnessModel {
  return HARNESS_MODELS.some(model => model.id === value);
}
