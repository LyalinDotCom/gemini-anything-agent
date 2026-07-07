import type { Session } from "../state/types";
import { T } from "../tokens";
import { Icon } from "./atoms";

function Row({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "132px minmax(0, 1fr)",
        gap: 10,
        alignItems: "start",
      }}
    >
      <span style={{ color: T.textFaint, fontSize: 12.5 }}>{label}</span>
      <code
        style={{
          color: value ? T.text : T.textFaint,
          fontFamily: T.mono,
          fontSize: 12.5,
          wordBreak: "break-all",
        }}
      >
        {value ?? "none"}
      </code>
    </div>
  );
}

export function ChatDiagnosticsPanel({
  session,
  streaming,
  canceling,
  onCancelServerTurn,
}: {
  session: Session;
  streaming: boolean;
  canceling: boolean;
  onCancelServerTurn: () => void;
}) {
  const canCancel = Boolean(
    session.pending?.interactionId || session.lastInteractionId,
  );

  return (
    <section
      aria-label="Chat diagnostics"
      style={{
        height: "100%",
        minHeight: 0,
        overflowY: "auto",
        padding: 14,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          marginBottom: 14,
        }}
      >
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: T.radiusSm,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: T.accentSoft,
            color: T.accent,
          }}
        >
          <Icon name="code" size={17} />
        </span>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 15.5 }}>Chat diagnostics</h2>
          <div style={{ color: T.textFaint, fontSize: 12 }}>
            IDs for recovery and server-side state
          </div>
        </div>
        <button
          type="button"
          disabled={!canCancel || canceling}
          onClick={onCancelServerTurn}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "7px 10px",
            borderRadius: T.radiusSm,
            border: `1px solid ${canCancel ? "rgba(255,107,107,0.42)" : T.borderSoft}`,
            background: canCancel ? T.dangerSoft : T.bgHover,
            color: canCancel ? T.danger : T.textFaint,
            fontSize: 12.5,
            fontWeight: 700,
            cursor: canCancel && !canceling ? "pointer" : "default",
          }}
        >
          <Icon name="stop" size={13} />
          {canceling ? "Cancelling..." : "Cancel server turn"}
        </button>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        <Row label="Local chat id" value={session.id} />
        <Row label="Title" value={session.title} />
        <Row label="Mode" value={session.mode} />
        <Row label="Agent" value={session.agentUsed} />
        <Row label="Last interaction" value={session.lastInteractionId} />
        <Row label="Container env" value={session.environmentId} />
        <Row label="Streaming" value={streaming ? "yes" : "no"} />
        <Row
          label="Pending interaction"
          value={session.pending?.interactionId}
        />
        <Row label="Pending message" value={session.pending?.messageId} />
        <Row
          label="Pending started"
          value={
            session.pending?.startedAt
              ? new Date(session.pending.startedAt).toLocaleString()
              : null
          }
        />
        <Row label="Output files" value={session.envFiles?.length ?? 0} />
        <Row label="Seen outputs" value={session.envSeen?.length ?? 0} />
        <Row label="Chain broken" value={session.chainBroken ? "yes" : "no"} />
      </div>
    </section>
  );
}
