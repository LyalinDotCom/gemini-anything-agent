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

export const outputMediaItem = (file: EnvironmentOutputFile): ResolvedEnvironmentMedia | undefined =>
  file.mediaType && file.url
    ? {
        requestedPath: file.sandboxPath,
        path: file.path,
        url: file.url,
        mediaType: file.mediaType
      }
    : undefined;
