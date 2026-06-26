import { describe, expect, it } from "vitest";
import { DEPRECATED_DEFAULT_DENYLIST, MODEL_REGISTRY } from "../src/models.js";

describe("model registry", () => {
  it("uses only 3.x media defaults", () => {
    const defaults = MODEL_REGISTRY.filter((entry) => "isDefault" in entry && entry.isDefault);
    expect(defaults.map((entry) => entry.id).sort()).toEqual([
      "gemini-3.1-flash-image",
      "gemini-3.1-flash-tts-preview",
      "veo-3.1-lite-generate-preview"
    ]);
  });

  it("does not use deprecated default IDs", () => {
    const defaults = MODEL_REGISTRY.filter((entry) => "isDefault" in entry && entry.isDefault);
    for (const entry of defaults) {
      expect(DEPRECATED_DEFAULT_DENYLIST).not.toContain(entry.id);
    }
  });

  it("only documents the supported MVP capabilities", () => {
    expect(new Set(MODEL_REGISTRY.map((entry) => entry.capability))).toEqual(
      new Set(["agy", "image", "video", "tts"])
    );
  });
});

