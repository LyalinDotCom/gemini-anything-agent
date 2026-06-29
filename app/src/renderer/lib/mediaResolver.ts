import type { EnvironmentOutputFile, ResolvedEnvironmentMedia } from "../../shared/electron-api";
import type { Session } from "./builderState";
import type { SessionMediaState } from "./mediaState";
import { outputMediaItem } from "./outputFiles";
import { promptForInput } from "./interactionInput";

const MEDIA_PATH_PATTERN =
  /(?:\/workspace\/|workspace\/|\/tmp\/|outputs\/)[^\s`"'()[\]{}<>]+\.(?:png|jpe?g|webp|gif|avif|svg|mp4|webm|mov|m4v|wav|mp3|m4a|aac|ogg|flac)(?:[?#][^\s`"'()[\]{}<>]+)?/gi;
const MANAGED_OUTPUT_PATTERN = /(?:^|\/)outputs\/managed-agent\/[^/]+\/(.+)$/i;

const cleanMediaPath = (value: string): string =>
  value.replace(/[),.;:!?]+$/g, "").replace(/[?#].*$/, "");

const canonicalMediaPath = (value: string): string => {
  const cleaned = cleanMediaPath(value).replace(/\\/g, "/");
  const savedOutputMatch = cleaned.match(MANAGED_OUTPUT_PATTERN);
  if (savedOutputMatch?.[1]) {
    return `/workspace/output/${savedOutputMatch[1]}`;
  }
  return cleaned;
};

const TRANSCRIPT_REQUEST_PATTERN = /\b(transcrib(?:e|ed|ing)?|transcript|captions?|subtitles?|srt)\b/i;
const MEDIA_PRODUCING_REQUEST_PATTERN =
  /\b(?:image|picture|photo|video|tts|voiceover|narration|convert|mp3|generate\s+(?:an?\s+)?(?:image|video|audio)|create\s+(?:an?\s+)?(?:image|video|audio|podcast)|make\s+(?:an?\s+)?(?:image|video|audio|podcast))\b/i;

export const extractMediaPaths = (text: string | undefined): string[] => {
  if (!text) {
    return [];
  }
  return [...new Set([...text.matchAll(MEDIA_PATH_PATTERN)].map((match) => canonicalMediaPath(match[0])))];
};

export const shouldAutoResolveMedia = (session: Session): boolean => {
  const prompt = promptForInput(session.request.input);
  const transcriptionOnly =
    TRANSCRIPT_REQUEST_PATTERN.test(prompt) && !MEDIA_PRODUCING_REQUEST_PATTERN.test(prompt);
  return !transcriptionOnly;
};

export const mediaPathMatches = (item: ResolvedEnvironmentMedia, requestedPath: string): boolean => {
  const requested = canonicalMediaPath(requestedPath).replace(/^[/\\]+/, "");
  const requestedWithoutWorkspace = requested.replace(/^workspace\//, "");
  const candidates = [item.requestedPath, item.path, item.savedPath]
    .filter((value): value is string => Boolean(value))
    .map((value) => canonicalMediaPath(value).replace(/^[/\\]+/, ""));
  return candidates.some((candidate) => {
    const withoutWorkspace = candidate.replace(/^workspace\//, "");
    return (
      candidate === requested ||
      withoutWorkspace === requestedWithoutWorkspace ||
      candidate.endsWith(`/${requested}`) ||
      withoutWorkspace.endsWith(`/${requestedWithoutWorkspace}`)
    );
  });
};

export const mediaItemsCoverPaths = (items: ResolvedEnvironmentMedia[] | undefined, paths: string[]): boolean =>
  Boolean(items?.length) && paths.every((path) => items!.some((item) => mediaPathMatches(item, path)));

export const outputMediaItemsForPaths = (
  files: EnvironmentOutputFile[] | undefined,
  paths: string[]
): ResolvedEnvironmentMedia[] => {
  if (!files?.length || paths.length === 0) {
    return [];
  }

  const candidates = files.flatMap((file) => {
    const item = outputMediaItem(file);
    return item ? [item] : [];
  });
  const matched: ResolvedEnvironmentMedia[] = [];

  for (const path of paths) {
    const item = candidates.find((candidate) => mediaPathMatches(candidate, path));
    if (!item) {
      continue;
    }
    if (!matched.some((candidate) => candidate.url === item.url || candidate.path === item.path)) {
      matched.push({ ...item, requestedPath: path });
    }
  }

  return matched;
};

export const mergeResolvedMedia = (
  current: ResolvedEnvironmentMedia[] | undefined,
  incoming: ResolvedEnvironmentMedia[]
): ResolvedEnvironmentMedia[] => {
  const merged = [...(current ?? [])];
  for (const item of incoming) {
    const index = merged.findIndex(
      (candidate) =>
        candidate.requestedPath === item.requestedPath ||
        (candidate.savedPath && item.savedPath && candidate.savedPath === item.savedPath) ||
        candidate.url === item.url
    );
    if (index >= 0) {
      merged[index] = item;
    } else {
      merged.push(item);
    }
  }
  return merged;
};

export const cachedMediaStateForSession = (session: Session): SessionMediaState | undefined =>
  session.resolvedMedia?.length
    ? {
        loading: false,
        items: session.resolvedMedia
      }
    : undefined;

export const textFileNameForLabel = (label: string): string => {
  const stem = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "agent-output";
  return stem.endsWith(".md") || stem.endsWith(".txt") ? stem : `${stem}.md`;
};
