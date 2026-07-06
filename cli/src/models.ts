export type Capability = "agy" | "image" | "video" | "tts" | "music" | "transcribe";

export type ApiSurface = "interactions" | "generateVideos" | "managed-agent";

export type ModelRegistryEntry = {
  id: string;
  capability: Capability;
  label: string;
  status: "stable" | "preview";
  apiSurface: ApiSurface;
  isDefault?: boolean;
  notes: string;
};

export const MODEL_REGISTRY = [
  {
    id: "antigravity-preview-05-2026",
    capability: "agy",
    label: "AGY runtime",
    status: "preview",
    apiSurface: "managed-agent",
    notes: "Managed-agent brain; default base agent for `gai agent create` and runnable via `gai agent run`."
  },
  {
    id: "gemini-3.1-flash-image",
    capability: "image",
    label: "Image default",
    status: "stable",
    apiSurface: "interactions",
    isDefault: true,
    notes: "Default Gemini 3.x image generation and editing model."
  },
  {
    id: "gemini-3-pro-image",
    capability: "image",
    label: "Image pro",
    status: "stable",
    apiSurface: "interactions",
    notes: "Higher-end Gemini 3.x image model for professional layouts and precise text."
  },
  {
    id: "veo-3.1-lite-generate-preview",
    capability: "video",
    label: "Video default",
    status: "preview",
    apiSurface: "generateVideos",
    isDefault: true,
    notes: "Default lower-cost Veo 3.1 video route."
  },
  {
    id: "veo-3.1-generate-preview",
    capability: "video",
    label: "Video premium",
    status: "preview",
    apiSurface: "generateVideos",
    notes: "Premium Veo 3.1 route."
  },
  {
    id: "veo-3.1-fast-generate-preview",
    capability: "video",
    label: "Video fast premium",
    status: "preview",
    apiSurface: "generateVideos",
    notes: "Faster premium Veo 3.1 route."
  },
  {
    id: "gemini-3.1-flash-tts-preview",
    capability: "tts",
    label: "TTS default",
    status: "preview",
    apiSurface: "interactions",
    isDefault: true,
    notes: "Gemini 3.1 Flash TTS preview for speech generation."
  },
  {
    id: "lyria-3-clip-preview",
    capability: "music",
    label: "Music default",
    status: "preview",
    apiSurface: "interactions",
    isDefault: true,
    notes: "Lyria 3 Clip preview for short 30-second MP3 music generation."
  },
  {
    id: "lyria-3-pro-preview",
    capability: "music",
    label: "Music pro",
    status: "preview",
    apiSurface: "interactions",
    notes: "Lyria 3 Pro preview for longer-form song generation."
  },
  {
    id: "gemini-3.5-flash",
    capability: "transcribe",
    label: "Transcription default",
    status: "stable",
    apiSurface: "interactions",
    isDefault: true,
    notes: "Gemini 3.5 Flash audio understanding route for transcription, timestamps, and speaker labels."
  }
] as const satisfies readonly ModelRegistryEntry[];

export const DEPRECATED_DEFAULT_DENYLIST = [
  "imagen-4.0-generate-001",
  "imagen-4.0-ultra-generate-001",
  "imagen-4.0-fast-generate-001",
  "veo-2.0-generate-001",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-3-pro-preview",
  "lyria-2"
] as const;

export const defaultBaseAgent = (): string =>
  process.env.GEMINI_ANYTHING_BASE_AGENT || "antigravity-preview-05-2026";

export const defaultImageModel = (): string =>
  process.env.GEMINI_ANYTHING_IMAGE_MODEL || "gemini-3.1-flash-image";

export const defaultTtsModel = (): string =>
  process.env.GEMINI_ANYTHING_TTS_MODEL || "gemini-3.1-flash-tts-preview";

export const defaultMusicModel = (): string =>
  process.env.GEMINI_ANYTHING_MUSIC_MODEL || "lyria-3-clip-preview";

export const defaultTranscribeModel = (): string =>
  process.env.GEMINI_ANYTHING_TRANSCRIBE_MODEL || "gemini-3.5-flash";

export type VideoQuality = "lite" | "premium" | "fast-premium";

export const videoModelForQuality = (quality: VideoQuality): string => {
  const override = process.env.GEMINI_ANYTHING_VIDEO_MODEL;
  if (override) {
    return override;
  }
  if (quality === "premium") {
    return "veo-3.1-generate-preview";
  }
  if (quality === "fast-premium") {
    return "veo-3.1-fast-generate-preview";
  }
  return "veo-3.1-lite-generate-preview";
};

export const isDeprecatedDefault = (model: string): boolean =>
  DEPRECATED_DEFAULT_DENYLIST.includes(model as (typeof DEPRECATED_DEFAULT_DENYLIST)[number]);
