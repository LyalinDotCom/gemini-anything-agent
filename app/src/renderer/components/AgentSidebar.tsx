import { Boxes, Pencil, Plus, Settings, Trash2 } from "lucide-react";
import type { ManagedAgent } from "@sdk";
import { IconButton } from "./primitives";

const formatAgentTime = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString();
};

export const AgentSidebar = ({
  agents,
  selectedId,
  busy,
  onSelect,
  onEdit,
  onDelete,
  onNew,
  onSettings,
  hasApiKey
}: {
  agents: ManagedAgent[];
  selectedId: string;
  busy: boolean;
  onSelect: (agent: ManagedAgent) => void;
  onEdit: (agent: ManagedAgent) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
  hasApiKey: boolean;
}) => (
  <aside className="agent-sidebar">
    <header className="agent-sidebar-head">
      <div>
        <span className="eyebrow">Agents</span>
        <h2>{agents.length ? `${agents.length} saved` : "No saved agents"}</h2>
      </div>
      <div className="agent-sidebar-head-actions">
        <button type="button" className="primary-action sm" onClick={onNew} disabled={busy}>
          <Plus size={13} />
          New
        </button>
        <IconButton title={hasApiKey ? "Settings" : "Settings - API key missing"} onClick={onSettings}>
          <Settings size={14} />
        </IconButton>
      </div>
    </header>

    {agents.length === 0 ? (
      <div className="agent-sidebar-empty">
        <Boxes size={20} />
        <p>Create a draft in the editor. Saved agents will appear here.</p>
      </div>
    ) : (
      <div className="agent-sidebar-list">
        {agents.map((agent) => {
          const selected = agent.id === selectedId;
          const updated = formatAgentTime(agent.update_time ?? agent.create_time);
          return (
            <div className={`agent-sidebar-row ${selected ? "selected" : ""}`} key={agent.id}>
              <button type="button" className="agent-sidebar-select" onClick={() => onSelect(agent)} disabled={busy}>
                <strong>{agent.id}</strong>
                <span>{agent.description || updated || "Saved managed agent"}</span>
              </button>
              <IconButton title={`Edit ${agent.id}`} onClick={() => onEdit(agent)} disabled={busy}>
                <Pencil size={14} />
              </IconButton>
              <IconButton
                title={`Delete ${agent.id}`}
                tone="danger"
                onClick={() => onDelete(agent.id)}
                disabled={busy}
              >
                <Trash2 size={14} />
              </IconButton>
            </div>
          );
        })}
      </div>
    )}
  </aside>
);
