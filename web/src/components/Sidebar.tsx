import { useRef, useState } from "react";
import { useStore } from "../state/store";
import { T } from "../tokens";
import { Icon, IconButton, Spinner } from "./atoms";
import { profileForSession } from "../agentProfiles";

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
  onOpenAbout,
  onNavigate,
  onClose,
}: {
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  const sessionOrder = useStore((s) => s.sessionOrder);
  const sessions = useStore((s) => s.sessions);
  const drafts = useStore((s) => s.draftText);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const createSession = useStore((s) => s.createSession);
  const deleteSession = useStore((s) => s.deleteSession);
  const setActiveSession = useStore((s) => s.setActiveSession);
  const renameSession = useStore((s) => s.renameSession);
  const reorderSession = useStore((s) => s.reorderSession);
  const streaming = useStore((s) => s.streaming);
  const cancelledEdit = useRef(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);

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
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
          <div style={{flex:1}}><strong style={{fontSize:15}}>GAA</strong><div style={{fontSize:11,color:T.textFaint,marginTop:3}}>Gemini Anywhere Agent</div></div>
          {onClose && <IconButton name="x" label="Close chat history" onClick={onClose} />}
        </div>
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
            const preview = drafts[id]?.trim().replace(/\s+/g, " ").slice(0, 42);
            const displayTitle = !session.titleManuallySet && session.title === "New chat" && preview ? preview : session.title;
            const active = id === activeSessionId;
            const profile = profileForSession(session);
            return (
              <div
                key={id}
                draggable={editingId !== id}
                onDragStart={(event) => {
                  setDraggingId(id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", id);
                }}
                onDragEnd={() => setDraggingId(null)}
                onDragOver={(event) => {
                  if (draggingId && draggingId !== id) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const source = draggingId || event.dataTransfer.getData("text/plain");
                  if (source && source !== id) {
                    // Dropping on the lower half inserts below the hovered row
                    // (null target appends); insert-before alone made every
                    // downward move land one slot short.
                    const rect = event.currentTarget.getBoundingClientRect();
                    const below = event.clientY > rect.top + rect.height / 2;
                    const beforeId = below ? (sessionOrder[sessionOrder.indexOf(id) + 1] ?? null) : id;
                    if (beforeId !== source) reorderSession(source, beforeId);
                  }
                  setDraggingId(null);
                }}
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
                  minHeight: 44,
                  background: active ? T.bgHover : "transparent",
                  opacity: draggingId === id ? 0.5 : 1,
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = T.bgHover;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = active ? T.bgHover : "transparent";
                }}
              >
                <Icon name={profile.icon} size={15} color={T.textFaint} />
                {editingId === id ? (
                  <input
                    autoFocus
                    value={draftTitle}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onBlur={() => {
                      if (!cancelledEdit.current && draftTitle.trim() && draftTitle.trim() !== session.title) renameSession(id, draftTitle.trim());
                      cancelledEdit.current = false;
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelledEdit.current = true; setEditingId(null); }
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
                  <button
                    type="button"
                    aria-label={`Open chat: ${displayTitle}`}
                    aria-current={active ? "page" : undefined}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      cancelledEdit.current = false; setEditingId(id);
                      setDraftTitle(session.title);
                    }}
                    title="Double-click to rename"
                    style={{
                      flex: 1, minWidth: 0, minHeight: 36, textAlign: "left", padding: 0, border: 0, background: "transparent", cursor: "pointer",
                      fontSize: 13.5,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      color: active ? T.text : T.textDim,
                    }}
                  >
                    {displayTitle}
                  </button>
                )}
                {streaming[id] || session.pending || session.research ? (
                  <Spinner size={11} color={T.accent} />
                ) : (
                  <span style={{ fontSize: 11.5, color: T.textFaint }}>{relativeTime(session.updatedAt)}</span>
                )}
                <span onClick={event => event.stopPropagation()} style={{display:"inline-flex"}}>
                <IconButton name="edit" label="Rename chat" size={14} onClick={() => { cancelledEdit.current = false; setEditingId(id); setDraftTitle(session.title); }} style={{width:28,height:32}} />
                <IconButton
                  name="trash"
                  label={streaming[id] || session.pending || session.research ? "Stop this run before deleting" : "Delete chat"}
                  disabled={Boolean(streaming[id] || session.pending || session.research)}
                  size={14}
                  onClick={() => {
                    if (window.confirm(`Delete "${session.title}"?`)) deleteSession(id);
                  }}
                  style={{ width: 28, height: 32 }}
                />
                </span>
              </div>
            );
          })
        )}
      </div>

      <div style={{ padding: 10, borderTop: `1px solid ${T.borderSoft}` }}>
        <button type="button" onClick={onOpenAbout} style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", borderRadius: T.radiusSm, border: "none", background: "transparent", color: T.textDim, fontSize: 13.5, cursor: "pointer" }}>
          <Icon name="sparkle" size={16} /> About
        </button>
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
