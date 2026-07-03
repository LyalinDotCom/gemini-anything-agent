import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { ResolvedEnvironmentMedia } from "../../shared/electron-api";
import { BufferedAudio } from "./BufferedAudio";

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
