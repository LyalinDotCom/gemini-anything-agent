import { describe, expect, test } from "vitest";
import { contentFingerprint } from "../src/utils/contentFingerprint";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("output content fingerprints", () => {
  test("change when a file is replaced by different content of the same size", async () => {
    const first = await contentFingerprint("workspace/output/result.txt", bytes("first"));
    const second = await contentFingerprint("workspace/output/result.txt", bytes("other"));

    expect(first).not.toBe(second);
  });

  test("remain stable for the same path and content", async () => {
    const first = await contentFingerprint("workspace/output/result.txt", bytes("same"));
    const second = await contentFingerprint("workspace/output/result.txt", bytes("same"));

    expect(first).toBe(second);
  });
});
