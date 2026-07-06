import { useEffect, useState } from "react";
import { getMediaUrl } from "../storage/messages";
import { T } from "../tokens";
import { Icon, Spinner } from "./atoms";

export function ImagePart({
  mediaId,
  prompt,
  compact,
}: {
  mediaId: string;
  prompt?: string;
  compact?: boolean;
}) {
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

  if (missing) {
    return (
      <div
        style={{
          padding: "14px 16px",
          borderRadius: T.radiusSm,
          border: `1px dashed ${T.border}`,
          color: T.textFaint,
          fontSize: 13,
          margin: "8px 0",
        }}
      >
        Image no longer in local storage.
      </div>
    );
  }
  if (!url) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 14, color: T.textFaint }}>
        <Spinner size={14} /> loading image…
      </div>
    );
  }
  return (
    <figure style={{ margin: "8px 0", maxWidth: compact ? 220 : 440 }}>
      <a href={url} target="_blank" rel="noreferrer">
        <img
          src={url}
          alt={prompt ?? "image"}
          style={{
            width: "100%",
            borderRadius: T.radiusSm,
            border: `1px solid ${T.borderSoft}`,
            display: "block",
          }}
        />
      </a>
      <figcaption style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
        {prompt && (
          <span
            title={prompt}
            style={{
              flex: 1,
              fontSize: 12,
              color: T.textFaint,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {prompt}
          </span>
        )}
        <a href={url} download="generated-image" style={{ color: T.textDim, display: "inline-flex" }} title="Download">
          <Icon name="download" size={14} />
        </a>
      </figcaption>
    </figure>
  );
}
