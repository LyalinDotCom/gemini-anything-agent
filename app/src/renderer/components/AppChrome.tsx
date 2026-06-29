import {
  CheckCircle2,
  Download,
  File,
  PanelRightOpen,
  Trash2,
  XCircle
} from "lucide-react";

export type StatusEvent = {
  id: string;
  level: "info" | "success" | "error";
  title: string;
  detail?: string;
};

export const TopBar = ({ hasKey }: { hasKey: boolean }) => (
  <header className="topbar">
    <div className="brand">
      <h1>Gemini Anything Agent</h1>
    </div>

    <div className="topbar-actions">
      <span className={`agent-status ${hasKey ? "ok" : "warn"}`}>
        <span className="status-dot" />
        {hasKey ? "Ready" : "Key missing"}
      </span>
    </div>
  </header>
);

export const ChatHeader = ({
  title,
  running,
  appReady,
  environmentId,
  snapshotting,
  canDelete,
  onSnapshot,
  onDelete
}: {
  title: string;
  running: boolean;
  appReady: boolean;
  environmentId?: string;
  snapshotting: boolean;
  canDelete: boolean;
  onSnapshot: () => void;
  onDelete: () => void;
}) => (
  <div className="chat-main-head">
    <span className="chat-main-title">{title}</span>
    {running && <span className="live-dot">working…</span>}
    <span className="chat-main-head-spacer" />
    <button
      type="button"
      className="head-icon"
      title={environmentId ? `Snapshot ${environmentId}` : "No environment yet"}
      aria-label="Download environment snapshot"
      disabled={!appReady || !environmentId || running || snapshotting}
      onClick={onSnapshot}
    >
      <Download size={15} />
    </button>
    <button
      type="button"
      className="head-icon danger"
      title="Delete this conversation locally"
      aria-label="Delete this conversation"
      disabled={!appReady || !canDelete || running}
      onClick={onDelete}
    >
      <Trash2 size={15} />
    </button>
  </div>
);

export const OutputPanelToggle = ({
  fileCount,
  appReady,
  onClick
}: {
  fileCount: number;
  appReady: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    className="output-panel-toggle"
    title={fileCount > 0 ? `Show output files (${fileCount} available)` : "Show output files"}
    aria-label={fileCount > 0 ? `Show output files (${fileCount} available)` : "Show output files"}
    aria-pressed={false}
    disabled={!appReady}
    onClick={onClick}
  >
    <PanelRightOpen size={16} />
    {fileCount > 0 && (
      <span className="output-panel-toggle-badge" aria-hidden="true">
        <File size={10} />
      </span>
    )}
  </button>
);

export const AppStatusBar = ({
  status,
  hasBridge,
  agentId
}: {
  status: StatusEvent | null;
  hasBridge: boolean;
  agentId: string;
}) => (
  <footer className={`status-bar ${status?.level ?? ""}`} aria-live="polite">
    {status ? (
      <div className="status-message" key={status.id}>
        {status.level === "error" ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
        <strong>{status.title}</strong>
        {status.detail && <span>{status.detail}</span>}
      </div>
    ) : (
      <span className="status-empty">
        {hasBridge
          ? `Managed agent ${agentId}`
          : "Web preview: run the Electron app for live managed-agent calls."}
      </span>
    )}
  </footer>
);
