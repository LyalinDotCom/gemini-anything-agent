import { useRef, useState } from "react";
import {
  Info,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Trash2
} from "lucide-react";
import {
  formatConversationTime,
  type ConversationSummary
} from "../lib/conversations";

type ConversationSidebarProps = {
  collapsed: boolean;
  appReady: boolean;
  activeConversationId: string;
  conversations: ConversationSummary[];
  onToggleCollapsed: () => void;
  onNewConversation: () => void;
  onSelectConversation: (conversationId: string) => void;
  onDeleteConversation: (conversation: ConversationSummary) => void;
  /** dropSlot is the gap index among non-draft conversations (0..count). */
  onReorderConversation: (dragId: string, dropSlot: number) => void;
  onOpenAbout: () => void;
  onOpenSettings: () => void;
};

export const ConversationSidebar = ({
  collapsed,
  appReady,
  activeConversationId,
  conversations,
  onToggleCollapsed,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  onReorderConversation,
  onOpenAbout,
  onOpenSettings
}: ConversationSidebarProps) => {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reordering applies to saved conversations only; the "New chat" draft is
  // pinned above them and never moves.
  const reorderable = conversations.filter((conversation) => !conversation.draft);
  const slotOf = (conversationId: string): number =>
    reorderable.findIndex((conversation) => conversation.id === conversationId);

  const endDrag = () => {
    setDragId(null);
    setDropSlot(null);
  };

  const handleRowDragOver = (event: React.DragEvent, conversationId: string) => {
    if (!dragId) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const slot = slotOf(conversationId);
    if (slot < 0) {
      return;
    }
    // Above the row's midpoint the item lands before it, below lands after.
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    setDropSlot(after ? slot + 1 : slot);
  };

  const handleListDragOver = (event: React.DragEvent) => {
    if (!dragId) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    // Dragging past the last row drops at the end.
    const list = listRef.current;
    if (list) {
      const rows = list.querySelectorAll(".conversation-row:not(.draft)");
      const last = rows[rows.length - 1];
      if (last && event.clientY > last.getBoundingClientRect().bottom) {
        setDropSlot(reorderable.length);
      }
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    if (dragId && dropSlot !== null) {
      onReorderConversation(dragId, dropSlot);
    }
    endDrag();
  };

  const indicator = <div className="conversation-drop-indicator" aria-hidden="true" />;

  return (
    <aside
      className={`conversation-sidebar ${collapsed ? "collapsed" : ""}`}
      aria-label="Conversations"
    >
      <div className="conversation-head">
        <h2>Conversations</h2>
        <button
          type="button"
          className="head-icon sidebar-collapse"
          title={collapsed ? "Expand conversations" : "Collapse conversations"}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
        <button
          type="button"
          className="sidebar-new"
          title="New conversation"
          aria-label="New conversation"
          disabled={!appReady}
          onClick={onNewConversation}
        >
          <Plus size={15} />
        </button>
      </div>

      <div
        className="conversation-list"
        ref={listRef}
        onDragOver={handleListDragOver}
        onDrop={handleDrop}
      >
        {conversations.length === 0 ? (
          <div className="conversation-empty">No saved local conversations yet.</div>
        ) : (
          <>
            {conversations.map((conversation) => {
              const slot = conversation.draft ? -1 : slotOf(conversation.id);
              return (
                <div key={conversation.id}>
                  {dragId !== null && slot >= 0 && dropSlot === slot && indicator}
                  <div
                    className={`conversation-row ${conversation.draft ? "draft" : ""} ${
                      conversation.id === activeConversationId ? "active" : ""
                    } ${conversation.running ? "running" : ""} ${
                      conversation.id === dragId ? "dragging" : ""
                    }`}
                    draggable={!conversation.draft && appReady}
                    onDragStart={(event) => {
                      if (conversation.draft) {
                        return;
                      }
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", conversation.id);
                      setDragId(conversation.id);
                      // The drag swallows the click, which can leave the row's
                      // button stuck in a :focus-visible ring until something
                      // else takes focus.
                      if (document.activeElement instanceof HTMLElement) {
                        document.activeElement.blur();
                      }
                    }}
                    onDragOver={(event) => handleRowDragOver(event, conversation.id)}
                    onDragEnd={endDrag}
                  >
                    <button
                      type="button"
                      className="conversation-select"
                      aria-current={conversation.id === activeConversationId ? "true" : undefined}
                      disabled={!appReady}
                      onClick={() => onSelectConversation(conversation.id)}
                    >
                      {conversation.running ? (
                        <Loader2 className="spin conversation-running-icon" size={14} />
                      ) : (
                        <MessageSquare size={14} />
                      )}
                      <span>
                        <strong>{conversation.title}</strong>
                        <em>
                          {conversation.draft
                            ? "Draft"
                            : `${conversation.sessions.length} turn${conversation.sessions.length === 1 ? "" : "s"} · ${formatConversationTime(conversation.latestAt)}`}
                        </em>
                      </span>
                    </button>
                    {!conversation.draft && (
                      <button
                        type="button"
                        className="conversation-delete"
                        disabled={!appReady || conversation.running}
                        title="Delete local conversation"
                        onClick={() => onDeleteConversation(conversation)}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {dragId !== null && dropSlot === reorderable.length && indicator}
          </>
        )}
      </div>

      <div className="conversation-footer">
        <button
          type="button"
          className="sidebar-footer-button"
          title="About"
          aria-label="About"
          onClick={onOpenAbout}
        >
          <Info size={15} />
          <span>About</span>
        </button>
        <button
          type="button"
          className="sidebar-footer-button"
          title="Settings"
          aria-label="Settings"
          onClick={onOpenSettings}
        >
          <Settings size={15} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
};
