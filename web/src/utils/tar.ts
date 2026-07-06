// Minimal ustar reader for environment snapshots. Handles plain files (type '0'/'\0'),
// hard links (type '1' — snapshots contain them; resolved by copying the target's
// data), ustar prefix fields, and GNU 'L' long-name extensions; skips everything else.
export interface TarEntry {
  name: string;
  size: number;
  data: Uint8Array;
}

function readString(bytes: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const max = offset + length;
  while (end < max && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(offset, end));
}

function readOctal(bytes: Uint8Array, offset: number, length: number): number {
  const raw = readString(bytes, offset, length).trim();
  if (!raw) return 0;
  const n = Number.parseInt(raw, 8);
  return Number.isFinite(n) ? n : 0;
}

export function parseTar(buffer: ArrayBuffer): TarEntry[] {
  const bytes = new Uint8Array(buffer);
  const entries: TarEntry[] = [];
  let offset = 0;
  let pendingLongName: string | null = null;

  while (offset + 512 <= bytes.length) {
    const block = bytes.subarray(offset, offset + 512);
    if (block.every((b) => b === 0)) break; // end-of-archive

    const shortName = readString(bytes, offset, 100);
    const size = readOctal(bytes, offset + 124, 12);
    const typeFlag = String.fromCharCode(bytes[offset + 156] || 0x30);
    const linkName = readString(bytes, offset + 157, 100).replace(/^\.\//, "");
    const magic = readString(bytes, offset + 257, 5);
    const prefix = magic === "ustar" ? readString(bytes, offset + 345, 155) : "";

    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (typeFlag === "L") {
      // GNU long name: the data block holds the real name for the NEXT entry.
      pendingLongName = readString(bytes.subarray(dataStart, dataEnd), 0, size).replace(/\0+$/, "");
      continue;
    }

    const name = (pendingLongName ?? (prefix ? `${prefix}/${shortName}` : shortName)).replace(/^\.\//, "");
    pendingLongName = null;

    if ((typeFlag === "0" || typeFlag === "\0") && name && size >= 0 && dataEnd <= bytes.length) {
      entries.push({ name, size, data: bytes.slice(dataStart, dataEnd) });
    } else if (typeFlag === "1" && name && linkName) {
      // Hard link: duplicate content stored once — copy the link target's data.
      const target = entries.find((e) => e.name === linkName);
      if (target) entries.push({ name, size: target.size, data: target.data });
    }
  }
  return entries;
}
