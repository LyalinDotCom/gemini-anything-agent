// Renderers for non-image media pulled from the container (and voice messages):
// blobs live in IndexedDB; object URLs are created lazily and cached by storage/messages.
import { useEffect, useState } from "react";
import { getMediaUrl } from "../storage/messages";
import { T } from "../tokens";
import { Icon, Spinner } from "./atoms";

function useMediaUrl(mediaId: string): { url: string | null; missing: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    void getMediaUrl(mediaId).then((u) => {
      if (!alive) return;
      if (u) setUrl(u);
      else setMissing(true);
    });
    return () => {
      alive = false;
    };
  }, [mediaId]);
  return { url, missing };
}

function MissingNote({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: T.radiusSm,
        border: `1px dashed ${T.border}`,
        color: T.textFaint,
        fontSize: 13,
        margin: "8px 0",
      }}
    >
      {label} is no longer in local storage.
    </div>
  );
}

export function AudioPart({ mediaId, label }: { mediaId: string; label: string }) {
  const { url, missing } = useMediaUrl(mediaId);
  if (missing) return <MissingNote label={label} />;
  return (
    <figure style={{ margin: "8px 0" }}>
      {url ? (
        <audio controls src={url} style={{ width: "min(360px, 100%)", height: 36 }} />
      ) : (
        <Spinner size={14} />
      )}
      <figcaption style={{ fontSize: 12, color: T.textFaint, marginTop: 3 }}>🎵 {label}</figcaption>
    </figure>
  );
}

export function VideoPart({ mediaId, label }: { mediaId: string; label: string }) {
  const { url, missing } = useMediaUrl(mediaId);
  if (missing) return <MissingNote label={label} />;
  return (
    <figure style={{ margin: "8px 0", maxWidth: 440 }}>
      {url ? (
        <video
          controls
          src={url}
          style={{ width: "100%", borderRadius: T.radiusSm, border: `1px solid ${T.borderSoft}` }}
        />
      ) : (
        <Spinner size={14} />
      )}
      <figcaption style={{ fontSize: 12, color: T.textFaint, marginTop: 3 }}>🎬 {label}</figcaption>
    </figure>
  );
}

export function FilePart({ mediaId, label }: { mediaId: string; label: string }) {
  const { url, missing } = useMediaUrl(mediaId);
  if (missing) return <MissingNote label={label} />;
  return (
    <a
      href={url ?? "#"}
      download={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        margin: "6px 0",
        padding: "8px 13px",
        borderRadius: T.radiusSm,
        border: `1px solid ${T.border}`,
        background: T.bgElev,
        color: T.textDim,
        fontSize: 13,
        textDecoration: "none",
      }}
    >
      <Icon name="download" size={14} />
      {label}
    </a>
  );
}
