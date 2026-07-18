// The single registry of pinned ids. Never use "-latest" aliases (they get hot-swapped);
// never scatter model strings through the codebase. All ids verified live against the API.
export const MODELS = {
  /** Plain/default Antigravity profile and base for the two custom profiles. */
  chatAgentBase: "antigravity-preview-05-2026",
  /** Long-running research agent (background + polling/reattach). */
  deepResearch: "deep-research-preview-04-2026",
  /** Highest-effort long-running research agent. */
  deepResearchMax: "deep-research-max-preview-04-2026",
  /** Fast text model: session titles, transcription, utility calls. */
  text: "gemini-3.5-flash",
  /** Image generation (all three known ids verified live; flash is fastest). */
  image: "gemini-3.1-flash-image",
} as const;

/** The app-managed agent id created under the user's key on first chat. */
export const CHAT_AGENT_ID = "gai-anything-v1";
export const BROWSER_AGENT_ID = "gai-browser-v1";

export const APP_NAME = "Gemini Anything";
