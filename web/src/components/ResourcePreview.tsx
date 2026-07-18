import { useEffect, useState } from "react";
import type { OutputFileRecord } from "../state/types";
import { getMediaUrl } from "../storage/messages";
import { T } from "../tokens";
import { Icon, IconButton, Spinner } from "./atoms";

function fileName(file: OutputFileRecord): string {
  return file.label.split("/").filter(Boolean).pop() || "resource";
}

function useResourceUrl(file: OutputFileRecord | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (!file) return () => {
      alive = false;
    };
    void getMediaUrl(file.mediaId).then((next) => {
      if (alive) setUrl(next);
    });
    return () => {
      alive = false;
    };
  }, [file]);
  return url;
}

function useResourceText(file: OutputFileRecord | null, url: string | null): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setText(null);
    if (!file || file.kind !== "text" || !url) return () => { alive = false; };
    void fetch(url).then((response) => response.text()).then((value) => {
      if (alive) setText(value.length > 2_000_000 ? `${value.slice(0, 2_000_000)}\n\n[Preview truncated at 2 MB]` : value);
    });
    return () => { alive = false; };
  }, [file, url]);
  return text;
}

export function ResourceLightbox({ file, onClose }: { file: OutputFileRecord | null; onClose: () => void }) {
  const url = useResourceUrl(file);
  const text = useResourceText(file, url);
  if (!file) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "rgba(0,0,0,0.86)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px",
          borderBottom: `1px solid rgba(255,255,255,0.09)`,
        }}
      >
        <strong
          style={{
            flex: 1,
            minWidth: 0,
            color: T.text,
            fontSize: 14,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {file.label}
        </strong>
        {url && (
          <a
            href={url}
            download={fileName(file)}
            title="Download"
            style={{
              width: 36,
              height: 36,
              borderRadius: T.radiusSm,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: T.text,
              border: `1px solid rgba(255,255,255,0.16)`,
              background: "rgba(255,255,255,0.08)",
            }}
          >
            <Icon name="download" size={17} />
          </a>
        )}
        <IconButton
          name="x"
          label="Close"
          onClick={onClose}
          style={{
            width: 36,
            height: 36,
            color: T.text,
            border: `1px solid rgba(255,255,255,0.16)`,
            background: "rgba(255,255,255,0.08)",
          }}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
        {!url && <Spinner size={20} color={T.text} />}
        {url && file.kind === "image" && (
          <img
            src={url}
            alt={file.label}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: T.radiusSm }}
          />
        )}
        {url && file.kind === "video" && (
          <video
            controls
            autoPlay
            src={url}
            style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: T.radiusSm }}
          />
        )}
        {url && file.kind === "html" && (
          <iframe
            src={url}
            title={file.label}
            sandbox="allow-scripts"
            style={{ width: "100%", height: "100%", border: 0, borderRadius: T.radiusSm, background: "white" }}
          />
        )}
        {url && file.kind === "text" && text !== null && (
          <pre style={{ width: "100%", height: "100%", boxSizing: "border-box", overflow: "auto", margin: 0, padding: 18, borderRadius: T.radiusSm, background: T.bg, color: T.text, font: `12.5px/1.55 ${T.mono}`, whiteSpace: "pre-wrap" }}>{text}</pre>
        )}
      </div>
    </div>
  );
}

export function AudioDock({ file, onClose }: { file: OutputFileRecord | null; onClose: () => void }) {
  const url = useResourceUrl(file);
  if (!file) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        bottom: "calc(92px + env(safe-area-inset-bottom))",
        zIndex: 25,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          width: "min(680px, 100%)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderRadius: T.radius,
          border: `1px solid rgba(124,156,255,0.34)`,
          background: "rgba(20,20,25,0.96)",
          boxShadow: "0 16px 42px rgba(0,0,0,0.36)",
          pointerEvents: "auto",
        }}
      >
        <span style={{ color: T.accent, display: "inline-flex", flex: "0 0 auto" }}>
          <Icon name="audio" size={18} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              color: T.text,
              fontSize: 12.5,
              fontWeight: 700,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginBottom: 6,
            }}
          >
            {file.label}
          </div>
          {url ? <audio controls autoPlay src={url} style={{ width: "100%", height: 34 }} /> : <Spinner size={14} />}
        </div>
        {url && (
          <a href={url} download={fileName(file)} title="Download" style={{ color: T.textDim, display: "inline-flex" }}>
            <Icon name="download" size={17} />
          </a>
        )}
        <IconButton name="x" label="Close audio" onClick={onClose} />
      </div>
    </div>
  );
}
