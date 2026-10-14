export function isModelFile(file: { label: string; path: string; mimeType?: string }): boolean {
  return /\.glb$/i.test(file.label || file.path) || file.mimeType === "model/gltf-binary";
}
