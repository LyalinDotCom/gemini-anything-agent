import { useState } from "react";
import { downloadSnapshot, downloadSnapshotArchive, syncOutputMedia } from "../gemini/envFiles";
import { toFriendly } from "../gemini/errors";
import type { OutputFileRecord } from "../state/types";
import { getMediaUrl } from "../storage/messages";
import { linkProjectFolder, supportsLocalProjects, syncEntriesToProject, unlinkProjectFolder } from "../storage/localProjects";
import { useStore } from "../state/store";
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
  if (file.kind === "html") return "globe";
  if (file.kind === "text") return "code";
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
  const [projectStatus, setProjectStatus] = useState<string | null>(null);
  const localProjectName = useStore((s) => s.sessions[sessionId]?.localProjectName ?? null);
  const patchSession = useStore((s) => s.patchSession);
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

  const downloadArchive = async () => {
    if (!envId) {
      await downloadAll();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const blob = await downloadSnapshotArchive(envId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `gemini-anything-${envId}.tar`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      setError(toFriendly(e).message);
    } finally {
      setLoading(false);
    }
  };

  const linkOrSyncProject = async () => {
    if (!supportsLocalProjects()) {
      await downloadArchive();
      setProjectStatus("This browser cannot link folders; downloaded the project snapshot instead.");
      return;
    }
    setLoading(true);
    setError(null);
    setProjectStatus(null);
    try {
      let name = localProjectName;
      if (!name) {
        const handle = await linkProjectFolder(sessionId);
        name = handle.name;
        patchSession(sessionId, { localProjectName: name });
      }
      if (!envId) {
        await syncEntriesToProject(sessionId, [], true);
        setProjectStatus(`Linked ${name}. Conversation metadata is saved now; files will sync after the first agent run.`);
        return;
      }
      const entries = await downloadSnapshot(envId);
      const result = await syncEntriesToProject(sessionId, entries, true);
      if (!result || result.permission !== "granted") {
        setError("Folder permission was not granted.");
      } else {
        setProjectStatus(`Synced ${result.written} file${result.written === 1 ? "" : "s"} to ${result.name}.`);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Could not link the local folder.");
    } finally {
      setLoading(false);
    }
  };

  const unlinkProject = async () => {
    await unlinkProjectFolder(sessionId);
    patchSession(sessionId, { localProjectName: null });
    setProjectStatus("Local folder unlinked. Existing files were left untouched.");
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
          onClick={() => void downloadArchive()}
          disabled={!envId && sorted.length === 0}
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
            background: envId || sorted.length > 0 ? T.accent : T.bgHover,
            color: envId || sorted.length > 0 ? "#0B0B0D" : T.textFaint,
            fontSize: 13.5,
            fontWeight: 800,
            cursor: envId || sorted.length > 0 ? "pointer" : "default",
          }}
        >
          <Icon name="download" size={15} />
          Download snapshot
        </button>
        <IconButton
          name="refresh"
          label="Check output files"
          disabled={loading || !envId}
          onClick={() => void refresh()}
          style={{ border: `1px solid ${T.border}`, background: T.bgInput }}
        />
      </div>

      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${T.borderSoft}`, background: T.bg }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={() => void linkOrSyncProject()}
            disabled={loading}
            style={{ flex: 1, minWidth: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "8px 10px", borderRadius: T.radiusSm, border: `1px solid ${localProjectName ? "rgba(110,231,160,0.36)" : T.border}`, background: localProjectName ? "rgba(110,231,160,0.09)" : "transparent", color: localProjectName ? T.ok : T.textDim, cursor: loading ? "default" : "pointer", fontSize: 12.5, fontWeight: 700 }}
          >
            <Icon name="folder" size={14} />
            {localProjectName ? `Sync ${localProjectName}` : supportsLocalProjects() ? "Link local folder" : "Download project"}
          </button>
          {localProjectName && (
            <button type="button" onClick={() => void unlinkProject()} style={{ padding: "8px 9px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: "transparent", color: T.textFaint, cursor: "pointer", fontSize: 12 }}>Unlink</button>
          )}
        </div>
        <p style={{ margin: "6px 0 0", color: T.textFaint, fontSize: 10.75, lineHeight: 1.35 }}>
          {projectStatus ?? (supportsLocalProjects() ? "With permission, output files sync directly into this folder. Existing local files are never deleted." : "Folder linking needs desktop Chrome or Edge over HTTPS. Other browsers use downloads.")}
        </p>
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
