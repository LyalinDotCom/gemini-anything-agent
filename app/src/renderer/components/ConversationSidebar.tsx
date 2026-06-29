import {
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
  onOpenSettings
}: ConversationSidebarProps) => (
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

    <div className="conversation-list">
      {conversations.length === 0 ? (
        <div className="conversation-empty">No saved local conversations yet.</div>
      ) : (
        conversations.map((conversation) => (
          <div
            className={`conversation-row ${conversation.draft ? "draft" : ""} ${
              conversation.id === activeConversationId ? "active" : ""
            } ${conversation.running ? "running" : ""}`}
            key={conversation.id}
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
        ))
      )}
    </div>

    <div className="conversation-footer">
      <button
        type="button"
        className="sidebar-settings"
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
