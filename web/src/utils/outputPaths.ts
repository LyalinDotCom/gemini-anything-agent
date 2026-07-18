// The /workspace/output path rules, shared by the Files panel pipeline
// (gemini/envFiles) and the linked-folder sync (storage/localProjects): one
// predicate set so both surfaces always agree on which entries exist and how
// they are named.

/** Canonical "workspace/output/…" form for any accepted spelling, else null. */
export function normalizeOutputPath(path: string): string | null {
  const clean = path.trim().replace(/^resource:/, "").replace(/^\/+/, "");
  if (clean.startsWith("workspace/output/")) return clean;
  if (clean.startsWith("output/")) return `workspace/${clean}`;
  return null;
}

/** Path relative to workspace/output/ (the user-facing label). */
export function outputLabel(path: string): string {
  return path.replace(/^workspace\/output\//, "");
}

/** Output file the UI should show: no directories, no dot-segments. */
export function isVisibleOutputPath(path: string): boolean {
  const normalized = normalizeOutputPath(path);
  if (!normalized) return false;
  const rel = outputLabel(normalized);
  if (!rel || rel.endsWith("/")) return false;
  return rel.split("/").every((segment) => segment && !segment.startsWith("."));
}

/** Relative path segments for a visible output entry, else null. */
export function outputSegments(path: string): string[] | null {
  const normalized = normalizeOutputPath(path);
  if (!normalized || !isVisibleOutputPath(normalized)) return null;
  return outputLabel(normalized).split("/");
}
