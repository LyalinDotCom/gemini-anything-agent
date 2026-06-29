import { RefreshCw, XCircle } from "lucide-react";
import type { Session } from "../lib/builderState";

export const SessionControls = ({
  session,
  reconnecting,
  canReconnect,
  canRetry,
  canCancel,
  onReconnect,
  onRetry,
  onCancel
}: {
  session: Session;
  reconnecting: boolean;
  canReconnect: boolean;
  canRetry: boolean;
  canCancel: boolean;
  onReconnect: () => void;
  onRetry: () => void;
  onCancel: () => void;
}) => {
  const interactionId = session.seed?.id;
  const showReconnect = Boolean(interactionId && canReconnect);
  if (reconnecting || session.streaming || (!showReconnect && !canRetry)) {
    return null;
  }

  return (
    <div className="session-controls">
      {showReconnect && (
        <button
          type="button"
          className="ghost-button sm"
          disabled={reconnecting}
          title="Reconnect to this interaction stream and refresh status"
          onClick={onReconnect}
        >
          <RefreshCw size={12} className={reconnecting ? "spin" : undefined} />
          {reconnecting ? "Reconnecting" : "Reconnect"}
        </button>
      )}
      {canRetry && (
        <button
          type="button"
          className="ghost-button sm"
          title="Restore this turn's prompt and options in the composer"
          onClick={onRetry}
        >
          <RefreshCw size={12} />
          Retry prompt
        </button>
      )}
      {session.streaming && (
        <button
          type="button"
          className="ghost-button sm danger"
          disabled={!canCancel}
          title="Cancel this remote interaction"
          onClick={onCancel}
        >
          <XCircle size={12} />
          Cancel
        </button>
      )}
    </div>
  );
};
