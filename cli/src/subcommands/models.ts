import { MODEL_REGISTRY } from "../models.js";
import type { CommandResult } from "../types.js";

export const listModels = (): CommandResult => ({
  ok: true,
  capability: "models",
  message: "Gemini Anything media model registry",
  details: {
    models: MODEL_REGISTRY
  }
});

