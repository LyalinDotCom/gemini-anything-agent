// Container workspace browser: pulls the environment snapshot on open and lets the
// user view/play/download ANY file from the sandbox — the transparency window into
// what the agent actually did in there.
import { useEffect, useMemo, useState } from "react";
import { downloadSnapshot } from "../gemini/envFiles";
import { toFriendly } from "../gemini/errors";
import { T } from "../tokens";
import type { TarEntry } from "../utils/tar";
import { IconButton, Spinner } from "./atoms";

const VIEWABLE = /\.(png|jpe?g|gif|webp|svg|wav|mp3|m4a|ogg|mp4|webm|mov|txt|md|py|json|csv|log|html?)$/i;
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  svg: "image/svg+xml", wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
};

function fmtSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export function WorkspacePanel({ envId, onClose }: { envId: string; onClose: () => void }) {
  const [entries, setEntries] = useState<TarEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TarEntry | null>(null);

  useEffect(() => {
    let alive = true;
    downloadSnapshot(envId)
      .then((list) => {
        // Hide key material: the /.env file (GEMINI_API_KEY) and any legacy secrets dir.
        if (alive)
          setEntries(
            list.filter(
              (e) => !e.name.includes(".agents/secrets/") && e.name.replace(/^\.\//, "") !== ".env",
            ),
          );
      })
      .catch((e) => {
        if (alive) setError(toFriendly(e).message);
      });
    return () => {
      alive = false;
    };
  }, [envId]);

  const selectedUrl = useMemo(() => {
    if (!selected) return null;
    const ext = selected.name.split(".").pop()?.toLowerCase() ?? "";
    const bytes = new Uint8Array(selected.data);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: MIME[ext] ?? "application/octet-stream" });
    return URL.createObjectURL(blob);
  }, [selected]);
  useEffect(() => () => {
    if (selectedUrl) URL.revokeObjectURL(selectedUrl);
  }, [selectedUrl]);

  const preview = () => {
    if (!selected || !selectedUrl) return null;
    const ext = selected.name.split(".").pop()?.toLowerCase() ?? "";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
      return <img src={selectedUrl} alt={selected.name} style={{ maxWidth: "100%", borderRadius: T.radiusSm }} />;
    }
    if (["wav", "mp3", "m4a", "ogg"].includes(ext)) return <audio controls src={selectedUrl} style={{ width: "100%" }} />;
    if (["mp4", "webm", "mov"].includes(ext)) {
      return <video controls src={selectedUrl} style={{ maxWidth: "100%", borderRadius: T.radiusSm }} />;
    }
    const text = new TextDecoder().decode(selected.data.subarray(0, 20_000));
    return (
      <pre
        style={{
          margin: 0,
          padding: 12,
          background: "#101014",
          border: `1px solid ${T.borderSoft}`,
          borderRadius: T.radiusSm,
          fontSize: 12,
          fontFamily: T.mono,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 260,
          overflowY: "auto",
        }}
      >
        {text || "(binary)"}
      </pre>
    );
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      <div
        style={{
          position: "relative",
          width: "min(620px, calc(100vw - 28px))",
          maxHeight: "84vh",
          overflowY: "auto",
          background: T.bgElev,
          border: `1px solid ${T.border}`,
          borderRadius: T.radius,
          padding: 18,
          animation: "aichat-in 0.2s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 16, flex: 1 }}>Container files</h2>
          <IconButton name="x" label="Close" onClick={onClose} />
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: T.textFaint }}>
          Live snapshot of this session's server-side sandbox (env {envId.slice(0, 10)}…). Files under{" "}
          <code style={{ fontFamily: T.mono }}>/workspace/output/</code> auto-sync into the chat.
        </p>

        {error && <p style={{ color: T.danger, fontSize: 13 }}>{error}</p>}
        {!entries && !error && <Spinner size={16} />}

        {entries && entries.length === 0 && (
          <p style={{ color: T.textFaint, fontSize: 13 }}>The sandbox is empty so far.</p>
        )}

        {entries && entries.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {entries
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((e) => (
                <div
                  key={e.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 8px",
                    borderRadius: T.radiusSm,
                    background: selected?.name === e.name ? T.bgHover : "transparent",
                  }}
                >
                  <span
                    onClick={() => VIEWABLE.test(e.name) && setSelected(selected?.name === e.name ? null : e)}
                    style={{
                      flex: 1,
                      fontFamily: T.mono,
                      fontSize: 12.5,
                      color: VIEWABLE.test(e.name) ? T.text : T.textDim,
                      cursor: VIEWABLE.test(e.name) ? "pointer" : "default",
                      wordBreak: "break-all",
                    }}
                  >
                    {e.name}
                  </span>
                  <span style={{ fontSize: 11.5, color: T.textFaint, whiteSpace: "nowrap" }}>{fmtSize(e.size)}</span>
                  <a
                    download={e.name.split("/").pop()}
                    href={URL.createObjectURL(new Blob([new Uint8Array(e.data).buffer as ArrayBuffer]))}
                    style={{ color: T.textDim, display: "inline-flex" }}
                    title="Download"
                  >
                    <IconButton name="download" label="Download" size={14} style={{ width: 24, height: 24 }} />
                  </a>
                </div>
              ))}
          </div>
        )}

        {selected && <div style={{ marginTop: 12 }}>{preview()}</div>}
      </div>
    </div>
  );
}
