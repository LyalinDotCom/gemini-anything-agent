import { expect, test } from "vitest";
import { isModelFile } from "../src/utils/modelFiles";
test("recognizes self-contained GLB files from name or MIME", () => {
  expect(isModelFile({ path: "", label: "3d/run/object.GLB", mimeType: "application/octet-stream" })).toBe(true);
  expect(isModelFile({ path: "", label: "object", mimeType: "model/gltf-binary" })).toBe(true);
  expect(isModelFile({ path: "", label: "object.blend", mimeType: "application/octet-stream" })).toBe(false);
  expect(isModelFile({ path: "", label: "scene.gltf", mimeType: "model/gltf+json" })).toBe(false);
});
