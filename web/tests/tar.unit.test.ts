import { describe, expect, test } from "vitest";
import { parseTar } from "../src/utils/tar";

function tarOf(entries: Array<{ name: string; content: string; type?: string; linkName?: string }>): ArrayBuffer {
  const blocks: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (const e of entries) {
    const header = new Uint8Array(512);
    const name = enc.encode(e.name);
    header.set(name.subarray(0, 100), 0);
    const data = enc.encode(e.content);
    const sizeOctal = data.length.toString(8).padStart(11, "0") + "\0";
    header.set(enc.encode(sizeOctal), 124);
    header[156] = (e.type ?? "0").charCodeAt(0);
    if (e.linkName) header.set(enc.encode(e.linkName).subarray(0, 100), 157);
    header.set(enc.encode("ustar"), 257);
    // checksum field (not validated by our parser, but keep it plausible)
    header.set(enc.encode("        "), 148);
    blocks.push(header);
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    padded.set(data);
    if (data.length > 0) blocks.push(padded);
  }
  blocks.push(new Uint8Array(1024)); // end-of-archive
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out.buffer;
}

describe("parseTar", () => {
  test("reads plain files with sizes and data", () => {
    const buf = tarOf([
      { name: "output/red.png", content: "PNGDATA" },
      { name: "output/note.txt", content: "container says hi\n" },
    ]);
    const entries = parseTar(buf);
    expect(entries.map((e) => e.name)).toEqual(["output/red.png", "output/note.txt"]);
    expect(entries[0].size).toBe(7);
    expect(new TextDecoder().decode(entries[1].data)).toBe("container says hi\n");
  });

  test("skips directories and unknown types", () => {
    const buf = tarOf([
      { name: "output/", content: "", type: "5" },
      { name: "output/a.txt", content: "A" },
    ]);
    const entries = parseTar(buf);
    expect(entries.map((e) => e.name)).toEqual(["output/a.txt"]);
  });

  test("handles GNU long names", () => {
    const longName = `output/${"x".repeat(120)}.txt`;
    const buf = tarOf([
      { name: "././@LongLink", content: `${longName}\0`, type: "L" },
      { name: "output/truncated-short-name", content: "hello" },
    ]);
    const entries = parseTar(buf);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe(longName);
    expect(new TextDecoder().decode(entries[0].data)).toBe("hello");
  });

  test("hard links resolve to the target's data (snapshots contain them)", () => {
    const buf = tarOf([
      { name: "output/original.wav", content: "AUDIOBYTES" },
      { name: "output/linked.wav", content: "", type: "1", linkName: "output/original.wav" },
    ]);
    const entries = parseTar(buf);
    expect(entries.map((e) => e.name)).toEqual(["output/original.wav", "output/linked.wav"]);
    expect(new TextDecoder().decode(entries[1].data)).toBe("AUDIOBYTES");
    expect(entries[1].size).toBe(10);
  });

  test("empty archive → no entries", () => {
    expect(parseTar(new Uint8Array(1024).buffer)).toEqual([]);
  });
});
