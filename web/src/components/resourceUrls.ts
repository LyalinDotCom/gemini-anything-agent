import type { OutputFileRecord } from "../state/types";

export type ResourceUrlMap = ReadonlyMap<string, string>;

function normalizePath(value: string): string {
  const parts: string[] = [];
  for (const part of value.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function outputRelativePath(value: string): string {
  const normalized = normalizePath(value);
  const outputMarker = normalized.lastIndexOf("workspace/output/");
  return outputMarker >= 0 ? normalized.slice(outputMarker + "workspace/output/".length) : normalized;
}

export function buildResourceUrlMap(
  files: readonly OutputFileRecord[],
  urls: ReadonlyMap<string, string>,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const file of files) {
    const url = urls.get(file.mediaId);
    if (!url) continue;
    const label = outputRelativePath(file.label);
    const path = outputRelativePath(file.path);
    if (label) result.set(label, url);
    if (path) result.set(path, url);
  }
  return result;
}

export function resolveResourceUrl(
  reference: string,
  htmlPath: string,
  assets: ResourceUrlMap,
): string | null {
  const value = reference.trim();
  if (
    !value ||
    value.startsWith("#") ||
    value.startsWith("//") ||
    /^(?:[a-z][a-z\d+.-]*:)/i.test(value)
  ) {
    return null;
  }

  const suffixIndex = value.search(/[?#]/);
  const rawPath = suffixIndex >= 0 ? value.slice(0, suffixIndex) : value;
  const suffix = suffixIndex >= 0 ? value.slice(suffixIndex) : "";
  const cleanPath = decoded(rawPath);
  const htmlLabel = outputRelativePath(htmlPath);
  const slash = htmlLabel.lastIndexOf("/");
  const htmlDirectory = slash >= 0 ? htmlLabel.slice(0, slash) : "";
  const candidates = [
    outputRelativePath(cleanPath),
    normalizePath(`${htmlDirectory}/${cleanPath}`),
  ];

  for (const candidate of candidates) {
    const url = assets.get(candidate);
    if (url) return url.startsWith("data:") ? url : `${url}${suffix}`;
  }
  return null;
}

function replaceReference(
  value: string,
  htmlPath: string,
  assets: ResourceUrlMap,
): string {
  return resolveResourceUrl(value, htmlPath, assets) ?? value;
}

/**
 * Turn relative links in a generated HTML artifact into object URLs for sibling
 * output files. The HTML remains in a script-only sandbox; this only restores
 * the directory semantics that the original files had in /workspace/output.
 */
export function rewriteHtmlResourceUrls(
  html: string,
  htmlPath: string,
  assets: ResourceUrlMap,
): string {
  let result = html.replace(
    /(\b(?:src|href|poster)\s*=\s*)(["'])([^"']+)(\2)/gi,
    (_match, prefix: string, quote: string, value: string) =>
      `${prefix}${quote}${replaceReference(value, htmlPath, assets)}${quote}`,
  );

  result = result.replace(
    /(\bsrcset\s*=\s*)(["'])([^"']+)(\2)/gi,
    (_match, prefix: string, quote: string, value: string) => {
      const rewritten = value
        .split(",")
        .map((candidate) => {
          const match = candidate.trim().match(/^(\S+)(\s+.*)?$/);
          if (!match) return candidate;
          return `${replaceReference(match[1], htmlPath, assets)}${match[2] ?? ""}`;
        })
        .join(", ");
      return `${prefix}${quote}${rewritten}${quote}`;
    },
  );

  result = result.replace(
    /(url\(\s*)(["']?)([^"')]+)(\2\s*\))/gi,
    (_match, prefix: string, quote: string, value: string, suffix: string) =>
      `${prefix}${quote}${replaceReference(value, htmlPath, assets)}${suffix}`,
  );

  result = result.replace(
    /(\b(?:new\s+Audio|fetch)\(\s*)(["'])([^"']+)(\2)/gi,
    (_match, prefix: string, quote: string, value: string) =>
      `${prefix}${quote}${replaceReference(value, htmlPath, assets)}${quote}`,
  );

  return result;
}
