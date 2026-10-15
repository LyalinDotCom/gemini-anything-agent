// Minimal ustar reader for environment snapshots. Handles plain files (type '0'/'\0'),
// hard links (type '1' — snapshots contain them; resolved by copying the target's
// data), ustar prefix fields, and GNU 'L' long-name extensions; skips everything else.
export interface TarEntry {
  name: string;
  size: number;
  data: Uint8Array<ArrayBuffer>;
}

export interface TarStreamResult {
  entries: TarEntry[];
  /** Included hard links whose target lay outside the include filter (or later in
   *  the archive). The caller must re-parse buffered to resolve them. */
  unresolvedLinks: Array<{ name: string; linkName: string }>;
}

export class TarSizeLimitError extends Error {
  constructor(public readonly limitBytes: number) {
    super(`tar stream exceeded the ${limitBytes}-byte included-content limit`);
  }
}

/** Package downloaded output files when the server has no snapshot archive alias. */
export function createTarBlob(entries: TarEntry[]): Blob {
  const parts: BlobPart[] = [];
  const encode = new TextEncoder();
  const append = (name: string, data: Uint8Array<ArrayBuffer>, type = "0") => {
    const header = new Uint8Array(512);
    header.set(encode.encode(name).subarray(0, 100));
    const octal = (offset: number, length: number, value: number) => header.set(encode.encode(value.toString(8).padStart(length - 1, "0") + "\0"), offset);
    octal(100, 8, 0o644); octal(108, 8, 0); octal(116, 8, 0); octal(124, 12, data.byteLength); octal(136, 12, Math.floor(Date.now() / 1000));
    header.fill(32, 148, 156); header[156] = type.charCodeAt(0);
    header.set(encode.encode("ustar\0"), 257); header.set(encode.encode("00"), 263);
    header.set(encode.encode(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 "), 148);
    parts.push(header, data);
    if (data.byteLength % 512) parts.push(new Uint8Array(512 - data.byteLength % 512));
  };
  for (const entry of entries) {
    if (encode.encode(entry.name).length > 100) append("././@LongLink", encode.encode(entry.name + "\0"), "L");
    append(entry.name, entry.data);
  }
  parts.push(new Uint8Array(1024));
  return new Blob(parts, { type: "application/x-tar" });
}

function readString(bytes: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const max = Math.min(bytes.length, offset + length);
  while (end < max && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(offset, end));
}

function readOctal(bytes: Uint8Array, offset: number, length: number): number {
  const raw = readString(bytes, offset, length).trim();
  if (!raw) return 0;
  const n = Number.parseInt(raw, 8);
  return Number.isFinite(n) ? n : 0;
}

/** Decode one 512-byte ustar header block — the single copy of the field layout. */
function decodeUstarHeader(header: Uint8Array): {
  shortName: string;
  size: number;
  typeFlag: string;
  linkName: string;
  prefix: string;
} {
  const shortName = readString(header, 0, 100);
  const size = readOctal(header, 124, 12);
  const typeFlag = String.fromCharCode(header[156] || 0x30);
  const linkName = readString(header, 157, 100).replace(/^\.\//, "");
  const magic = readString(header, 257, 5);
  const prefix = magic === "ustar" ? readString(header, 345, 155) : "";
  return { shortName, size, typeFlag, linkName, prefix };
}

function entryName(pendingLongName: string | null, prefix: string, shortName: string): string {
  return (pendingLongName ?? (prefix ? `${prefix}/${shortName}` : shortName)).replace(/^\.\//, "");
}

export function parseTar(buffer: ArrayBuffer): TarEntry[] {
  const bytes = new Uint8Array(buffer);
  const entries: TarEntry[] = [];
  let offset = 0;
  let pendingLongName: string | null = null;
  let pendingLongLink: string | null = null;

  while (offset + 512 <= bytes.length) {
    const block = bytes.subarray(offset, offset + 512);
    if (block.every((b) => b === 0)) break; // end-of-archive
    const { shortName, size, typeFlag, linkName, prefix } = decodeUstarHeader(block);

    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (dataEnd > bytes.length) throw new Error("The snapshot archive ended before a file was complete.");
    if (typeFlag === "L" || typeFlag === "K") {
      const value = readString(bytes.subarray(dataStart, dataEnd), 0, size).replace(/\0+$/, "");
      if (typeFlag === "L") pendingLongName = value; else pendingLongLink = value;
      continue;
    }

    const name = entryName(pendingLongName, prefix, shortName);
    const targetName = (pendingLongLink ?? linkName).replace(/^\.\//, "");
    pendingLongName = null; pendingLongLink = null;

    if ((typeFlag === "0" || typeFlag === "\0") && name && size >= 0 && dataEnd <= bytes.length) {
      entries.push({ name, size, data: bytes.slice(dataStart, dataEnd) });
    } else if (typeFlag === "1" && name && targetName) {
      // Hard link: duplicate content stored once — copy the link target's data.
      const target = entries.find((e) => e.name === targetName);
      if (target) entries.push({ name, size: target.size, data: target.data });
    }
  }
  return entries;
}

/**
 * Incremental tar reader used for large remote environment snapshots. It skips
 * unselected file bodies without retaining them, so a browser/npm cache outside
 * /workspace/output cannot exhaust the web tab before we reach the artifacts.
 * `maxIncludedBytes` bounds only the retained (included) content.
 */
export async function parseTarStream(
  stream: ReadableStream<Uint8Array>,
  include: (name: string) => boolean,
  maxIncludedBytes?: number,
): Promise<TarStreamResult> {
  const reader = stream.getReader();
  let buffered: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let ended = false;

  const fill = async (): Promise<boolean> => {
    if (ended) return false;
    const next = await reader.read();
    if (next.done) {
      ended = true;
      return false;
    }
    if (buffered.length === 0) buffered = next.value;
    else {
      const joined = new Uint8Array(buffered.length + next.value.length);
      joined.set(buffered);
      joined.set(next.value, buffered.length);
      buffered = joined;
    }
    return true;
  };

  // Advance with zero-copy subarray views; the one real copy happens at the
  // return point so retained entry data never pins a whole network chunk.
  const take = async (size: number): Promise<Uint8Array<ArrayBuffer> | null> => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < size) {
      if (buffered.length === 0 && !(await fill())) return null;
      const count = Math.min(size - total, buffered.length);
      chunks.push(buffered.subarray(0, count));
      buffered = buffered.subarray(count);
      total += count;
    }
    if (chunks.length === 1) return chunks[0].slice();
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  };

  const skip = async (size: number): Promise<boolean> => {
    let remaining = size;
    while (remaining > 0) {
      if (buffered.length === 0 && !(await fill())) return false;
      const count = Math.min(remaining, buffered.length);
      buffered = buffered.subarray(count);
      remaining -= count;
    }
    return true;
  };

  const entries: TarEntry[] = [];
  const unresolvedLinks: Array<{ name: string; linkName: string }> = [];
  let includedBytes = 0;
  let pendingLongName: string | null = null;
  let pendingLongLink: string | null = null;
  for (;;) {
    const header = await take(512);
    if (!header) throw new Error("The snapshot archive ended before its end marker.");
    if (header.every((byte) => byte === 0)) break;
    const { shortName, size, typeFlag, linkName, prefix } = decodeUstarHeader(header);
    const padding = Math.ceil(size / 512) * 512 - size;

    if (typeFlag === "L" || typeFlag === "K") {
      if (size > 1024 * 1024) throw new Error("Snapshot path metadata is too large.");
      const longName = await take(size);
      if (!longName) throw new Error("The snapshot path metadata was cut off.");
      const value = readString(longName, 0, size).replace(/\0+$/, "");
      if (typeFlag === "L") pendingLongName = value; else pendingLongLink = value;
      if (!(await skip(padding))) throw new Error("The snapshot archive padding was cut off.");
      continue;
    }

    const name = entryName(pendingLongName, prefix, shortName);
    const targetName = (pendingLongLink ?? linkName).replace(/^\.\//, "");
    pendingLongName = null; pendingLongLink = null;
    if ((typeFlag === "0" || typeFlag === "\0") && name && include(name)) {
      includedBytes += size;
      if (maxIncludedBytes !== undefined && includedBytes > maxIncludedBytes) {
        await reader.cancel().catch(() => undefined);
        throw new TarSizeLimitError(maxIncludedBytes);
      }
      const data = await take(size);
      if (!data) throw new Error("The snapshot file body was cut off.");
      entries.push({ name, size, data });
      if (!(await skip(padding))) throw new Error("The snapshot archive padding was cut off.");
    } else {
      if (!(await skip(size + padding))) throw new Error("The snapshot archive body was cut off.");
      if (typeFlag === "1" && name && targetName && include(name)) {
        const target = entries.find((entry) => entry.name === targetName);
        if (target) {
          includedBytes += target.size;
          if (maxIncludedBytes !== undefined && includedBytes > maxIncludedBytes) { await reader.cancel().catch(() => undefined); throw new TarSizeLimitError(maxIncludedBytes); }
          entries.push({ name, size: target.size, data: target.data });
        }
        else unresolvedLinks.push({ name, linkName: targetName });
      }
    }
  }
  await reader.cancel().catch(() => undefined);
  return { entries, unresolvedLinks };
}
