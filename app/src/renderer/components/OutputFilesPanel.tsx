import {
  Archive,
  Download,
  ExternalLink,
  File,
  FileText,
  FolderOpen,
  ImageIcon,
  Loader2,
  Maximize2,
  Music2,
  RefreshCw,
  Video,
  X
} from "lucide-react";
import type { EnvironmentOutputFile } from "../../shared/electron-api";
import type { EnvironmentOutputState } from "../lib/mediaState";
import { formatFileSize, outputFileLabel, outputMediaItem } from "../lib/outputFiles";

const OutputFileIcon = ({ file }: { file: EnvironmentOutputFile }) => {
  switch (file.fileType) {
    case "image":
      return <ImageIcon size={15} />;
    case "video":
      return <Video size={15} />;
    case "audio":
      return <Music2 size={15} />;
    case "html":
    case "text":
    case "document":
      return <FileText size={15} />;
    case "archive":
      return <Archive size={15} />;
    default:
      return <File size={15} />;
  }
};

export const OutputFilesPanel = ({
  state,
  environmentId,
  onRefresh,
  onSave,
  onOpen,
  onClose
}: {
  state: EnvironmentOutputState | undefined;
  environmentId: string | undefined;
  onRefresh: () => void;
  onSave: (file: EnvironmentOutputFile) => void;
  onOpen: (file: EnvironmentOutputFile) => void;
  onClose: () => void;
}) => {
  const panelState = state ?? { loading: false, items: [] };
  const canRefresh = Boolean(environmentId && !panelState.loading);

  return (
    <aside className="output-panel" aria-label="Workspace output files">
      <header className="output-panel-head">
        <span className="output-panel-title">
          <FolderOpen size={15} />
          Output
        </span>
        <button
          type="button"
          className="head-icon"
          title="Refresh output files"
          aria-label="Refresh output files"
          disabled={!canRefresh}
          onClick={onRefresh}
        >
          <RefreshCw size={14} className={panelState.loading ? "spin" : undefined} />
        </button>
        <button
          type="button"
          className="head-icon"
          title="Minimize output panel"
          aria-label="Minimize output panel"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </header>
      <div className="output-panel-subtitle">/workspace/output</div>
      {panelState.error && (
        <div className="output-panel-error">
          <span>{panelState.error}</span>
          <button type="button" className="ghost-button sm" disabled={!canRefresh} onClick={onRefresh}>
            Retry
          </button>
        </div>
      )}
      {panelState.loading && (
        <div className="output-panel-loading">
          <Loader2 size={14} className="spin" />
          <span>{panelState.items.length > 0 ? "Refreshing files..." : "Checking output files..."}</span>
        </div>
      )}
      <div className="output-file-list">
        {!panelState.loading && panelState.items.length === 0 && !panelState.error && (
          <div className="output-panel-empty">
            <FolderOpen size={22} />
            <strong>{environmentId ? "No output files yet" : "No workspace yet"}</strong>
            <span>{environmentId ? "Generated artifacts will appear here." : "Start a chat to create one."}</span>
          </div>
        )}
        {panelState.items.map((file, index) => {
          const media = outputMediaItem(file);
          return (
            <div className="output-file-row" key={`${file.path}:${file.modifiedAt}:${index}`}>
              <span className={`output-file-icon file-${file.fileType}`}>
                <OutputFileIcon file={file} />
              </span>
              <div className="output-file-main">
                <strong title={file.sandboxPath}>{file.relativePath}</strong>
                <span>
                  {outputFileLabel(file)} · {formatFileSize(file.bytes)}
                </span>
              </div>
              <div className="output-file-actions">
                <button
                  type="button"
                  className="icon-action"
                  title={media ? "Open player" : "Open file"}
                  aria-label={media ? "Open player" : "Open file"}
                  onClick={() => onOpen(file)}
                >
                  {media ? <Maximize2 size={13} /> : <ExternalLink size={13} />}
                </button>
                <button
                  type="button"
                  className="icon-action"
                  title="Save As"
                  aria-label="Save As"
                  onClick={() => onSave(file)}
                >
                  <Download size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
};
