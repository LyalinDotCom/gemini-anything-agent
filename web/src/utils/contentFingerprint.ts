const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export async function contentFingerprint(path: string, data: Uint8Array): Promise<string> {
  const input = new Uint8Array(data.byteLength);
  input.set(data);
  // Path and byte length alone cannot detect equal-size replacements.
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return `${path}@sha256:${hex(new Uint8Array(digest))}`;
}
