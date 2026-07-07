import { useState } from "react";
import { syncOutputMedia } from "../gemini/envFiles";
import { toFriendly } from "../gemini/errors";
import type { OutputFileRecord } from "../state/types";
import { getMediaUrl } from "../storage/messages";
import { T } from "../tokens";
import { Icon, IconButton, Spinner } from "./atoms";

function fmtSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function fileName(file: OutputFileRecord): string {
  return file.label.split("/").filter(Boolean).pop() || "resource";
}

function iconFor(file: OutputFileRecord): string {
  if (file.kind === "audio") return "audio";
  if (file.kind === "video") return "video";
  if (file.kind === "image") return "image";
  return "file";
}

async function downloadFile(file: OutputFileRecord): Promise<void> {
  const url = await getMediaUrl(file.mediaId);
  if (!url) return;
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName(file);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function WorkspacePanel({
  sessionId,
  envId,
  files,
  newFingerprints,
  onOpenFile,
}: {
  sessionId: string;
  envId: string | null;
  files: OutputFileRecord[];
  newFingerprints: Set<string>;
  onOpenFile: (file: OutputFileRecord) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sorted = [...files].sort(
    (a, b) => b.syncedAt - a.syncedAt || a.label.localeCompare(b.label),
  );

  const refresh = async () => {
    if (!envId) {
      setError("Container id unavailable for this chat.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await syncOutputMedia(sessionId, envId);
    } catch (e) {
      setError(toFriendly(e).message);
    } finally {
      setLoading(false);
    }
  };

  const downloadAll = async () => {
    for (const file of sorted) {
      await downloadFile(file);
    }
  };

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
      aria-label="Output resources"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: 12,
          borderBottom: `1px solid ${T.borderSoft}`,
        }}
      >
        <button
          type="button"
          onClick={() => void downloadAll()}
          disabled={sorted.length === 0}
          style={{
            flex: 1,
            minWidth: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "9px 12px",
            borderRadius: T.radiusSm,
            border: "none",
            background: sorted.length > 0 ? T.accent : T.bgHover,
            color: sorted.length > 0 ? "#0B0B0D" : T.textFaint,
            fontSize: 13.5,
            fontWeight: 800,
            cursor: sorted.length > 0 ? "pointer" : "default",
          }}
        >
          <Icon name="download" size={15} />
          Download all
        </button>
        <IconButton
          name="refresh"
          label="Check output files"
          disabled={loading || !envId}
          onClick={() => void refresh()}
          style={{ border: `1px solid ${T.border}`, background: T.bgInput }}
        />
      </div>

      <div
        style={{
          padding: "0 12px",
          borderBottom:
            error || loading ? `1px solid ${T.borderSoft}` : undefined,
        }}
      >
        {error && (
          <div style={{ padding: "9px 0", color: T.danger, fontSize: 12.5 }}>
            {error}
          </div>
        )}
        {loading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "9px 0",
              color: T.textFaint,
              fontSize: 12.5,
            }}
          >
            <Spinner size={13} />
            Checking output files...
          </div>
        )}
      </div>

      <div style={{ overflowY: "auto", padding: 10, minHeight: 0 }}>
        {sorted.length === 0 ? (
          <div
            style={{
              padding: "28px 12px",
              textAlign: "center",
              color: T.textFaint,
              fontSize: 13,
            }}
          >
            {envId ? "No output files yet." : "No container files available."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sorted.map((file) => {
              const isNew = newFingerprints.has(file.fingerprint);
              return (
                <div
                  key={file.fingerprint}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 9px",
                    borderRadius: T.radiusSm,
                    border: `1px solid ${isNew ? "rgba(124,156,255,0.36)" : T.borderSoft}`,
                    background: isNew ? "rgba(124,156,255,0.1)" : T.bg,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onOpenFile(file)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      background: "transparent",
                      border: "none",
                      color: T.text,
                      padding: 0,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <Icon
                      name={iconFor(file)}
                      size={15}
                      color={isNew ? T.accent : T.textDim}
                    />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 13,
                      }}
                      title={file.label}
                    >
                      {file.label}
                    </span>
                  </button>
                  {isNew && (
                    <span
                      style={{
                        color: T.accent,
                        background: T.accentSoft,
                        borderRadius: 999,
                        padding: "2px 6px",
                        fontSize: 10.5,
                        fontWeight: 800,
                      }}
                    >
                      New
                    </span>
                  )}
                  <span
                    style={{
                      color: T.textFaint,
                      fontSize: 11.5,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fmtSize(file.size)}
                  </span>
                  <button
                    type="button"
                    title="Download"
                    aria-label={`Download ${file.label}`}
                    onClick={() => void downloadFile(file)}
                    style={{
                      width: 27,
                      height: 27,
                      borderRadius: T.radiusSm,
                      border: "none",
                      background: "transparent",
                      color: T.textDim,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
                  >
                    <Icon name="download" size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
