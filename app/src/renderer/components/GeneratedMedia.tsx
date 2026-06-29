import { useEffect, useState } from "react";
import { Download, Maximize2, X } from "lucide-react";
import type { ResolvedEnvironmentMedia } from "../../shared/electron-api";
import type { SessionMediaState } from "../lib/mediaState";
import { BufferedAudio } from "./BufferedAudio";

export const SessionMedia = ({
  state,
  onSave,
  onRetry,
  onOpen
}: {
  state: SessionMediaState | undefined;
  onSave: (item: ResolvedEnvironmentMedia) => void;
  onRetry: () => void;
  onOpen: (item: ResolvedEnvironmentMedia) => void;
}) => {
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set());
  const itemUrlKey = state?.items.map((item) => item.url).join("\n") ?? "";

  useEffect(() => {
    setFailedUrls((current) => {
      if (!state?.items.length || current.size === 0) {
        return current.size === 0 ? current : new Set();
      }
      const available = new Set(state.items.map((item) => item.url));
      const next = new Set([...current].filter((url) => available.has(url)));
      return next.size === current.size ? current : next;
    });
  }, [itemUrlKey, state?.items]);

  const markFailed = (url: string) => {
    setFailedUrls((current) => new Set(current).add(url));
  };

  if (!state || (!state.loading && state.items.length === 0 && !state.error)) {
    return null;
  }

  return (
    <div className="session-media">
      {state.loading && state.items.length === 0 && (
        <div className="media-progress">
          <span>{state.stage ?? "Downloading generated media..."}</span>
          <div className="media-progress-track" aria-hidden="true">
            <span style={{ width: `${state.progress ?? 35}%` }} />
          </div>
        </div>
      )}
      {state.error && state.items.length === 0 && (
        <div className="media-error-row">
          <span className="media-error">{state.error}</span>
          <button type="button" className="ghost-button sm" onClick={onRetry}>
            Retry download
          </button>
        </div>
      )}
      {state.items.map((item, index) => {
        const opensFromCard = item.mediaType !== "audio";
        const failed = failedUrls.has(item.url);
        return (
          <figure
            className={`media-card media-${item.mediaType} ${opensFromCard ? "can-open" : ""}`}
            key={`${item.requestedPath}:${item.url}:${index}`}
            onClick={(event) => {
              if (!opensFromCard) {
                return;
              }
              const tag = event.target instanceof HTMLElement ? event.target.tagName.toLowerCase() : "";
              if (tag !== "video" && tag !== "audio" && tag !== "button") {
                onOpen(item);
              }
            }}
          >
            {failed ? (
              <div className="media-preview-error" role="status">
                <span>Preview could not be loaded.</span>
                <button type="button" className="ghost-button sm" onClick={onRetry}>
                  Redownload
                </button>
              </div>
            ) : item.mediaType === "image" ? (
              <img
                src={item.url}
                alt={item.requestedPath}
                loading="eager"
                onError={() => markFailed(item.url)}
                onClick={() => onOpen(item)}
              />
            ) : item.mediaType === "video" ? (
              <video src={item.url} controls preload="metadata" onError={() => markFailed(item.url)} />
            ) : (
              <BufferedAudio src={item.url} />
            )}
            <figcaption>
              <span>
                {item.requestedPath}
                {item.savedPath && (
                  <>
                    <br />
                    Saved locally: <code>{item.savedPath}</code>
                  </>
                )}
              </span>
              <button type="button" className="ghost-button sm" onClick={() => onSave(item)}>
                <Download size={12} />
                Save As
              </button>
              <button type="button" className="ghost-button sm" onClick={() => onOpen(item)}>
                <Maximize2 size={12} />
                {item.mediaType === "audio" ? "Open player" : "Open"}
              </button>
              <button type="button" className="ghost-button sm" onClick={onRetry}>
                Redownload
              </button>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
};

export const MediaLightbox = ({
  item,
  onClose
}: {
  item: ResolvedEnvironmentMedia | null;
  onClose: () => void;
}) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [item?.url]);

  if (!item) {
    return null;
  }

  return (
    <div className="media-lightbox-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className={`media-lightbox media-${item.mediaType}`} onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <strong>{item.requestedPath}</strong>
            {item.savedPath && <code>{item.savedPath}</code>}
          </div>
          <button type="button" className="ghost-button sm" onClick={onClose}>
            <X size={14} />
            Close
          </button>
        </header>
        <div className="media-lightbox-body">
          {failed ? (
            <div className="media-preview-error" role="status">
              <span>Preview could not be loaded.</span>
            </div>
          ) : item.mediaType === "image" ? (
            <img src={item.url} alt={item.requestedPath} onError={() => setFailed(true)} />
          ) : item.mediaType === "video" ? (
            <video src={item.url} controls autoPlay onError={() => setFailed(true)} />
          ) : (
            <BufferedAudio src={item.url} autoPlay />
          )}
        </div>
      </div>
    </div>
  );
};
