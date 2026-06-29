import type { EnvironmentOutputFile, ResolvedEnvironmentMedia } from "../../shared/electron-api";

export const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
};

export const outputFileLabel = (file: EnvironmentOutputFile): string => {
  switch (file.fileType) {
    case "html":
      return "HTML";
    case "text":
      return "Text";
    case "document":
      return "Document";
    case "archive":
      return "Archive";
    case "image":
      return "Image";
    case "video":
      return "Video";
    case "audio":
      return "Audio";
    default:
      return "File";
  }
};

const cleanOutputPath = (value: string): string =>
  value.replace(/[),.;:!?]+$/g, "").replace(/[?#].*$/, "").replace(/^[/\\]+/, "").replace(/\\/g, "/");

export const outputFileMatchesPath = (file: EnvironmentOutputFile, requestedPath: string): boolean => {
  const requested = cleanOutputPath(requestedPath);
  const requestedWithoutWorkspace = requested.replace(/^workspace\//, "");
  const candidates = [file.sandboxPath, file.relativePath, file.path]
    .filter((value): value is string => Boolean(value))
    .map(cleanOutputPath);

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

export const outputFilesCoverPaths = (files: EnvironmentOutputFile[] | undefined, paths: string[]): boolean =>
  Boolean(files?.length) && paths.every((path) => files!.some((file) => outputFileMatchesPath(file, path)));

export const outputMediaItem = (file: EnvironmentOutputFile): ResolvedEnvironmentMedia | undefined =>
  file.mediaType && file.url
    ? {
        requestedPath: file.sandboxPath,
        path: file.path,
        url: file.url,
        mediaType: file.mediaType
      }
    : undefined;
