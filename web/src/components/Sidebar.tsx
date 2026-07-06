import { useState } from "react";
import { isUntouchedSession, useStore } from "../state/store";
import { T } from "../tokens";
import { Icon, IconButton, Spinner } from "./atoms";

function relativeTime(ts: number): string {
  const d = Date.now() - ts;
  const min = Math.floor(d / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  return days < 7 ? `${days}d` : new Date(ts).toLocaleDateString();
}

export function Sidebar({
  onOpenSettings,
  onNavigate,
}: {
  onOpenSettings: () => void;
  onNavigate?: () => void;
}) {
  const sessionOrder = useStore((s) => s.sessionOrder);
  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const createSession = useStore((s) => s.createSession);
  const deleteSession = useStore((s) => s.deleteSession);
  const setActiveSession = useStore((s) => s.setActiveSession);
  const renameSession = useStore((s) => s.renameSession);
  const streaming = useStore((s) => s.streaming);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  return (
    <div
      style={{
        width: T.sidebarW,
        minWidth: T.sidebarW,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: T.bgElev,
        borderRight: `1px solid ${T.borderSoft}`,
      }}
    >
      <div style={{ padding: 12 }}>
        <button
          type="button"
          onClick={() => {
            createSession();
            onNavigate?.();
          }}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "11px 13px",
            borderRadius: T.radiusSm,
            border: `1px solid ${T.border}`,
            background: "transparent",
            color: T.text,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Icon name="plus" size={16} />
          New chat
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
        {sessionOrder.length === 0 ? (
          <p style={{ color: T.textFaint, fontSize: 13, padding: "8px 10px" }}>No conversations yet.</p>
        ) : (
          sessionOrder.map((id) => {
            const session = sessions[id];
            if (!session) return null;
            const active = id === activeSessionId;
            return (
              <div
                key={id}
                onClick={() => {
                  setActiveSession(id);
                  onNavigate?.();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 10px",
                  marginBottom: 2,
                  borderRadius: T.radiusSm,
                  background: active ? T.bgHover : "transparent",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = T.bgHover;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = active ? T.bgHover : "transparent";
                }}
              >
                <Icon name={session.mode === "deep-research" ? "brain" : "chat"} size={15} color={T.textFaint} />
                {editingId === id ? (
                  <input
                    autoFocus
                    value={draftTitle}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onBlur={() => {
                      if (draftTitle.trim()) renameSession(id, draftTitle.trim());
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    style={{
                      flex: 1,
                      background: T.bg,
                      border: `1px solid ${T.accent}`,
                      borderRadius: 6,
                      color: T.text,
                      fontSize: 13,
                      padding: "3px 6px",
                      outline: "none",
                      minWidth: 0,
                    }}
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingId(id);
                      setDraftTitle(session.title);
                    }}
                    title="Double-click to rename"
                    style={{
                      flex: 1,
                      fontSize: 13.5,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      color: active ? T.text : T.textDim,
                    }}
                  >
                    {session.title}
                  </span>
                )}
                {streaming[id] ? (
                  <Spinner size={11} color={T.accent} />
                ) : (
                  <span style={{ fontSize: 11.5, color: T.textFaint }}>{relativeTime(session.updatedAt)}</span>
                )}
                <IconButton
                  name="trash"
                  label={isUntouchedSession(session) ? "Nothing to delete yet" : "Delete chat"}
                  size={14}
                  disabled={isUntouchedSession(session)}
                  onClick={() => {
                    if (window.confirm(`Delete "${session.title}"?`)) deleteSession(id);
                  }}
                  style={{ width: 24, height: 24 }}
                />
              </div>
            );
          })
        )}
      </div>

      <div style={{ padding: 10, borderTop: `1px solid ${T.borderSoft}` }}>
        <button
          type="button"
          onClick={onOpenSettings}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "9px 12px",
            borderRadius: T.radiusSm,
            border: "none",
            background: "transparent",
            color: T.textDim,
            fontSize: 13.5,
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = T.bgHover;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          }}
        >
          <Icon name="gear" size={16} />
          Settings
        </button>
      </div>
    </div>
  );
}
