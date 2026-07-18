import { memo, useMemo, useState } from "react";
import { groupParts, settleParts } from "../chat/blocksToParts";
import type { ContentPart, Message } from "../state/types";
import { T } from "../tokens";
import { Icon, Spinner } from "./atoms";
import { ImagePart } from "./ImagePart";
import { Markdown } from "./Markdown";
import { AudioPart } from "./MediaParts";
import { ToolActivityChip } from "./ToolActivityChip";

function ThoughtPart({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ margin: "4px 0" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "transparent",
          border: "none",
          color: T.textFaint,
          fontSize: 12.5,
          cursor: "pointer",
          padding: "2px 0",
        }}
      >
        {streaming ? <Spinner size={11} /> : <Icon name="brain" size={13} />}
        {streaming ? "Thinking…" : "Thought for a moment"}
        <Icon
          name="chevron"
          size={12}
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>
      {open && (
        <div
          style={{
            borderLeft: `2px solid ${T.border}`,
            padding: "4px 0 4px 12px",
            margin: "4px 0 6px 4px",
            color: T.textDim,
            fontSize: 13,
            whiteSpace: "pre-wrap",
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

function CodePart({ part }: { part: Extract<ContentPart, { kind: "code" }> }) {
  const [open, setOpen] = useState(false);
  const running = !part.done;
  const anyError = part.runs.some((r) => r.isError);
  const n = part.runs.length;
  const label = running
    ? n > 1
      ? `Running code ×${n}…`
      : "Running code…"
    : anyError
      ? n > 1
        ? `Ran code ×${n} (with errors)`
        : "Code failed"
      : n > 1
        ? `Ran code ×${n}`
        : "Ran code";
  return (
    <div style={{ margin: "6px 0" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "5px 11px",
          borderRadius: 20,
          border: `1px solid ${running ? T.accentSoft : T.borderSoft}`,
          background: running ? T.accentSoft : T.bgElev,
          color: running ? T.accent : anyError ? T.danger : T.textDim,
          fontSize: 12.5,
          cursor: "pointer",
        }}
      >
        {running ? (
          <Spinner size={12} color={T.accent} />
        ) : (
          <Icon name="code" size={13} />
        )}
        {label}
        <Icon
          name="chevron"
          size={12}
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>
      {open && (
        <div
          style={{
            marginTop: 6,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {part.runs.map((run, i) => (
            <div key={i}>
              <pre
                style={{
                  margin: 0,
                  padding: "12px 13px",
                  background: "#101014",
                  border: `1px solid ${T.borderSoft}`,
                  borderRadius:
                    run.result !== undefined
                      ? `${T.radiusSm}px ${T.radiusSm}px 0 0`
                      : T.radiusSm,
                  fontSize: 12.5,
                  fontFamily: T.mono,
                  overflowX: "auto",
                }}
              >
                {run.code || "…"}
              </pre>
              {run.result !== undefined && (
                <pre
                  style={{
                    margin: 0,
                    padding: "10px 13px",
                    background: T.bgElev,
                    border: `1px solid ${T.borderSoft}`,
                    borderTop: "none",
                    borderRadius: `0 0 ${T.radiusSm}px ${T.radiusSm}px`,
                    fontSize: 12.5,
                    fontFamily: T.mono,
                    color: run.isError ? T.danger : T.textDim,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    maxHeight: 240,
                    overflowY: "auto",
                  }}
                >
                  {run.result}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OutputLink({
  label,
  onOpenResourcePath,
}: {
  label: string;
  onOpenResourcePath?: (path: string) => void;
}) {
  const path = label.startsWith("/workspace/output/")
    ? label
    : `/workspace/output/${label}`;
  return (
    <button
      type="button"
      onClick={() => onOpenResourcePath?.(path)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        margin: "4px 0",
        padding: "5px 8px",
        borderRadius: T.radiusSm,
        border: `1px solid ${T.border}`,
        background: T.bgElev,
        color: T.accent,
        fontSize: 13,
        cursor: onOpenResourcePath ? "pointer" : "default",
      }}
    >
      <Icon name="file" size={13} />
      {label.replace(/^\/?workspace\/output\//, "")}
    </button>
  );
}

export const MessageBubble = memo(function MessageBubble({
  message,
  onOpenResourcePath,
  onRetry,
}: {
  message: Message;
  onOpenResourcePath?: (path: string) => void;
  onRetry?: () => void;
}) {
  const isUser = message.role === "user";
  const streaming = message.status === "streaming";
  // Only the post-stream Copy/Save footer reads this — don't rebuild it on every
  // streaming flush.
  const responseText = useMemo(() => message.parts.flatMap((part) => {
    if (part.kind === "text" || part.kind === "thought") return [part.text];
    if (part.kind === "code") return part.runs.flatMap((run) => [`\`\`\`\n${run.code}\n\`\`\``, run.result ?? ""]);
    return [];
  }).filter(Boolean).join("\n\n"), [message.parts]);
  const durationSeconds = message.completedAt ? Math.max(0, Math.round((message.completedAt - message.createdAt) / 1000)) : null;
  // Grouping is a RENDER concern: transcripts persist raw parts, so history always
  // benefits from the current grouping logic.
  const parts = useMemo(() => {
    const grouped = isUser ? message.parts : groupParts(message.parts);
    if (isUser || streaming) return grouped;
    const normalized = grouped.map((part) => {
      if (
        part.kind !== "tool" ||
        part.id !== "recover-note" ||
        part.activity.status !== "running"
      )
        return part;
      const stopped = message.status === "stopped";
      const failed = message.status === "error";
      return {
        ...part,
        activity: {
          ...part.activity,
          label: failed
            ? "Recovery failed"
            : stopped
              ? "Recovery stopped"
              : "Recovered this turn from the server after a reload",
          status: failed ? ("error" as const) : ("done" as const),
        },
      };
    });
    return settleParts(normalized, message.status === "error");
  }, [isUser, message.parts, message.status, streaming]);

  if (isUser) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          margin: "14px 0",
          animation: "aichat-in 0.2s ease",
        }}
      >
        <div
          style={{
            maxWidth: "78%",
            background: T.accentSoft,
            border: `1px solid rgba(124,156,255,0.25)`,
            borderRadius: `${T.radius}px ${T.radius}px 4px ${T.radius}px`,
            padding: "10px 14px",
          }}
        >
          {message.parts.map((part) =>
            part.kind === "text" ? (
              <div
                key={part.id}
                style={{
                  fontSize: 14.5,
                  lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {part.text}
              </div>
            ) : part.kind === "image" ? (
              <ImagePart key={part.id} mediaId={part.mediaId} compact />
            ) : part.kind === "audio" ? (
              <AudioPart
                key={part.id}
                mediaId={part.mediaId}
                label={part.label}
              />
            ) : null,
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ margin: "14px 0", animation: "aichat-in 0.2s ease" }}>
      {parts.length === 0 && streaming && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            color: T.textDim,
            fontSize: 13.5,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: T.accent,
              animation: "aichat-pulse 1.1s ease infinite",
            }}
          />
          Working…
        </div>
      )}
      {parts.map((part, i) => {
        const isLast = i === parts.length - 1;
        switch (part.kind) {
          case "text":
            return (
              <Markdown
                key={part.id}
                text={part.text + (streaming && isLast ? " ▍" : "")}
                onOpenResourcePath={onOpenResourcePath}
              />
            );
          case "thought":
            return (
              <ThoughtPart
                key={part.id}
                text={part.text}
                streaming={streaming && isLast}
              />
            );
          case "code":
            return <CodePart key={part.id} part={part} />;
          case "tool":
            return <ToolActivityChip key={part.id} activity={part.activity} />;
          case "image":
            if (part.origin === "agent") {
              return (
                <OutputLink
                  key={part.id}
                  label={part.prompt ?? "image"}
                  onOpenResourcePath={onOpenResourcePath}
                />
              );
            }
            return (
              <ImagePart
                key={part.id}
                mediaId={part.mediaId}
                prompt={part.prompt}
              />
            );
          case "audio":
            return (
              <OutputLink
                key={part.id}
                label={part.label}
                onOpenResourcePath={onOpenResourcePath}
              />
            );
          case "video":
            return (
              <OutputLink
                key={part.id}
                label={part.label}
                onOpenResourcePath={onOpenResourcePath}
              />
            );
          case "file":
            return (
              <OutputLink
                key={part.id}
                label={part.label}
                onOpenResourcePath={onOpenResourcePath}
              />
            );
          default:
            return null;
        }
      })}
      {message.status === "error" && (
        <div
          style={{
            marginTop: 8,
            padding: "9px 12px",
            borderRadius: T.radiusSm,
            background: T.dangerSoft,
            border: `1px solid rgba(255,107,107,0.3)`,
            color: T.danger,
            fontSize: 13,
          }}
        >
          {message.errorMessage ?? "Something went wrong."}
        </div>
      )}
      {message.status === "stopped" && (
        <div style={{ marginTop: 6, color: T.textFaint, fontSize: 12.5 }}>
          Stopped.
        </div>
      )}
      {onRetry && (
        <button type="button" onClick={onRetry} style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 9px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.bgElev, color: T.textDim, cursor: "pointer", fontSize: 12.5 }}>
          <Icon name="refresh" size={13} /> Retry prompt
        </button>
      )}
      {!streaming && responseText && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, color: T.textFaint, fontSize: 11.5 }}>
          <button type="button" aria-label="Copy response" onClick={() => void navigator.clipboard?.writeText(responseText)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 7px", borderRadius: 6, border: `1px solid ${T.borderSoft}`, background: "transparent", color: T.textFaint, cursor: "pointer", fontSize: 11.5 }}><Icon name="copy" size={12} /> Copy</button>
          <button type="button" aria-label="Download response" onClick={() => {
            const url = URL.createObjectURL(new Blob([responseText], { type: "text/markdown" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = "gemini-anything-response.md";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 30_000);
          }} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 7px", borderRadius: 6, border: `1px solid ${T.borderSoft}`, background: "transparent", color: T.textFaint, cursor: "pointer", fontSize: 11.5 }}><Icon name="download" size={12} /> Save</button>
          {durationSeconds !== null && <span>{durationSeconds}s</span>}
          {message.usage?.inputTokens !== undefined && <span>{message.usage.inputTokens} in</span>}
          {message.usage?.outputTokens !== undefined && <span>{message.usage.outputTokens} out</span>}
        </div>
      )}
    </div>
  );
});
