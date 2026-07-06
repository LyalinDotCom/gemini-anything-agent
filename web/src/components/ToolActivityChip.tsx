import { useState } from "react";
import type { ToolActivity } from "../state/types";
import { T } from "../tokens";
import { Icon, Spinner } from "./atoms";

const ICONS: Record<ToolActivity["tool"], string> = {
  code_execution: "code",
  google_search: "search",
  url_context: "globe",
  generate_image: "image",
  function: "sparkle",
  setup: "gear",
  other: "sparkle",
};

export function ToolActivityChip({ activity }: { activity: ToolActivity }) {
  const [open, setOpen] = useState(false);
  const hasDetail = activity.detail !== undefined && activity.detail !== null && activity.detail !== "";
  const color = activity.status === "error" ? T.danger : activity.status === "done" ? T.textDim : T.accent;

  return (
    <div style={{ margin: "6px 0" }}>
      <button
        type="button"
        onClick={hasDetail ? () => setOpen(!open) : undefined}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "5px 11px",
          borderRadius: 20,
          border: `1px solid ${activity.status === "running" ? T.accentSoft : T.borderSoft}`,
          background: activity.status === "running" ? T.accentSoft : T.bgElev,
          color,
          fontSize: 12.5,
          cursor: hasDetail ? "pointer" : "default",
        }}
      >
        {activity.status === "running" ? <Spinner size={12} color={T.accent} /> : <Icon name={ICONS[activity.tool]} size={13} />}
        <span style={{ maxWidth: 380, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {activity.label}
          {(activity.count ?? 1) > 1 ? ` ×${activity.count}` : ""}
        </span>
        {hasDetail && <Icon name="chevron" size={12} style={{ transform: open ? "rotate(180deg)" : undefined }} />}
      </button>
      {open && hasDetail && (
        <pre
          style={{
            margin: "6px 0 0",
            padding: "10px 12px",
            background: "#101014",
            border: `1px solid ${T.borderSoft}`,
            borderRadius: T.radiusSm,
            fontSize: 12,
            fontFamily: T.mono,
            color: T.textDim,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 220,
            overflowY: "auto",
          }}
        >
          {typeof activity.detail === "string" ? activity.detail : JSON.stringify(activity.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}
