import { useState } from "react";
import { Copy, X } from "lucide-react";
import { BadgeChip } from "./CapabilityCard";
import { Segmented } from "./primitives";
import type { PayloadNode } from "../lib/payload";

type PayloadView = "minimal" | "full";
type PayloadTab = "agent" | "interaction";

const PayloadRows = ({ nodes, view }: { nodes: PayloadNode[]; view: PayloadView }) => {
  const visible = view === "minimal" ? nodes.filter((node) => node.present) : nodes;
  return (
    <div className="payload-rows">
      {visible.map((node) => (
        <div key={node.keyPath} className={`payload-row ${node.present ? "" : "omitted"}`}>
          <span className={`state-dot dot-${node.state}`} aria-hidden />
          <code className="payload-key">{node.keyPath}</code>
          <span className="payload-value">{node.rendered}</span>
          {!node.present && node.note && <span className="payload-note">{node.note}</span>}
        </div>
      ))}
    </div>
  );
};

const fullText = (nodes: PayloadNode[], minimalJson: string): string => {
  const omitted = nodes.filter((node) => !node.present && node.note);
  if (!omitted.length) {
    return minimalJson;
  }
  const comments = omitted.map((node) => `//   ${node.keyPath}: ${node.note}`).join("\n");
  return `${minimalJson}\n\n// Omitted — the API applies these defaults:\n${comments}`;
};

export const PayloadDrawer = ({
  open,
  onClose,
  agentNodes,
  interactionNodes,
  agentJson,
  interactionJson,
  onCopy
}: {
  open: boolean;
  onClose: () => void;
  agentNodes: PayloadNode[];
  interactionNodes: PayloadNode[];
  agentJson: string;
  interactionJson: string;
  onCopy: (text: string, label: string) => void;
}) => {
  const [tab, setTab] = useState<PayloadTab>("agent");
  const [view, setView] = useState<PayloadView>("full");

  const nodes = tab === "agent" ? agentNodes : interactionNodes;
  const json = tab === "agent" ? agentJson : interactionJson;
  const label = tab === "agent" ? "Agent payload" : "Interaction payload";

  return (
    <aside className={`payload-drawer ${open ? "open" : ""}`} inert={!open} aria-label="Payload">
      <header className="drawer-head">
        <div className="drawer-title">
          <h3>Payload</h3>
          <span>POST {tab === "agent" ? "/agents" : "/interactions"}</span>
        </div>
        <button type="button" className="icon-button" title="Close payload" onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      <div className="drawer-controls">
        <Segmented
          value={tab}
          options={[
            { value: "agent", label: "Agent" },
            { value: "interaction", label: "Interaction" }
          ]}
          onChange={setTab}
        />
        <Segmented
          value={view}
          options={[
            { value: "minimal", label: "Minimal" },
            { value: "full", label: "Full" }
          ]}
          onChange={setView}
        />
      </div>

      <div className="drawer-legend">
        <BadgeChip state="required" />
        <BadgeChip state="fixed" />
        <BadgeChip state="custom" />
        <BadgeChip state="default" />
        <BadgeChip state="addon" />
        <span className="drawer-legend-hint">
          {view === "minimal"
            ? "Exactly what is sent on the wire."
            : "Plus the keys you omitted, dimmed."}
        </span>
      </div>

      <div className="drawer-body">
        <PayloadRows nodes={nodes} view={view} />
        <div className="drawer-json">
          <div className="section-label">
            <div className="row-actions">
              <button type="button" className="link-button" onClick={() => onCopy(json, `${label} (minimal)`)}>
                <Copy size={12} /> Copy minimal
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => onCopy(fullText(nodes, json), `${label} (annotated)`)}
              >
                <Copy size={12} /> Copy annotated
              </button>
            </div>
          </div>
          <pre className="json-block">{json}</pre>
        </div>
      </div>
    </aside>
  );
};
