import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Copy,
  CornerDownRight,
  Download,
  GitFork,
  Info,
  Loader2,
  Maximize2,
  Minimize2,
  Trash2,
  XCircle
} from "lucide-react";
import {
  extractInteractionOutputText,
  type Interaction,
  type InteractionStreamEvent,
  type InteractionUsage
} from "@sdk";
import type { Session } from "../lib/builderState";
import { isTerminal, sessionStatus, useInteractionPoller, type SessionStatus } from "../lib/usePoller";
import { buildTimeline } from "../lib/timeline";
import { Transcript } from "./Transcript";

type IconType = typeof CircleDot;
export type ResultsView = "chat" | "raw";

const NO_EVENTS: InteractionStreamEvent[] = [];

const STATUS_META: Record<SessionStatus, { label: string; icon: IconType; spin?: boolean }> = {
  queued: { label: "Queued", icon: Loader2, spin: true },
  running: { label: "Running", icon: Loader2, spin: true },
  succeeded: { label: "Succeeded", icon: CheckCircle2 },
  failed: { label: "Failed", icon: XCircle },
  unknown: { label: "Unknown", icon: CircleDot }
};

const formatDuration = (ms: number): string => {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
};

const formatStarted = (value: number): string =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });

const compactTokens = (value: unknown): string | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  }
  return String(value);
};

const usageRows = (usage: InteractionUsage | undefined): Array<[string, string]> => {
  if (!usage) {
    return [];
  }
  const cell = (value: unknown): string | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : undefined;
  return (
    [
      ["Total", cell(usage.total_tokens)],
      ["Input", cell(usage.total_input_tokens)],
      ["Output", cell(usage.total_output_tokens)],
      ["Thought", cell(usage.total_thought_tokens)],
      ["Tool use", cell(usage.total_tool_use_tokens)],
      ["Cached", cell(usage.total_cached_tokens)]
    ] as Array<[string, string | undefined]>
  ).filter((row): row is [string, string] => Boolean(row[1]));
};

const environmentLabel = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sourceCount = Array.isArray(record.sources) ? record.sources.length : 0;
    const network =
      record.network === "disabled"
        ? "network disabled"
        : record.network && typeof record.network === "object"
          ? "network allowlist"
          : "default network";
    return `${String(record.type ?? "config")} (${sourceCount} source${sourceCount === 1 ? "" : "s"}, ${network})`;
  }
  return "not sent";
};

const toolsLabel = (value: unknown): string => {
  if (!Array.isArray(value)) {
    return "inherits / default";
  }
  if (value.length === 0) {
    return "none";
  }
  return value
    .map((tool) =>
      typeof tool === "string"
        ? tool
        : tool && typeof tool === "object"
          ? String((tool as Record<string, unknown>).type ?? "tool")
          : "tool"
    )
    .join(", ");
};

const thinkingSummaryLabel = (value: unknown): string => {
  if (!value || typeof value !== "object") {
    return "off";
  }
  const config = value as Record<string, unknown>;
  return typeof config.thinking_summaries === "string" ? config.thinking_summaries : "off";
};

const promptText = (session: Session): string =>
  typeof session.request.input === "string"
    ? session.request.input
    : session.request.input
        .map((part) => (part.type === "text" ? part.text : `[image: ${part.mime_type}]`))
        .join("\n");

const SetupRow = ({ label, value }: { label: string; value: string }) => (
  <div className="setup-row">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const SetupTab = ({ session, usage }: { session: Session; usage: InteractionUsage | undefined }) => {
  const [showRequest, setShowRequest] = useState(false);
  const [showAgent, setShowAgent] = useState(false);
  const agent = session.agentSnapshot;
  const tokens = usageRows(usage);

  return (
    <div className="setup">
      <div className="setup-block">
        <span className="setup-eyebrow">Run request</span>
        <SetupRow label="Agent" value={session.request.agent} />
        <SetupRow label="Environment" value={environmentLabel(session.request.environment)} />
        <SetupRow label="Store" value={session.request.store === false ? "off" : "on"} />
        <SetupRow label="Background" value={session.request.background ? "on" : "off"} />
        <SetupRow label="Service tier" value={session.request.service_tier ?? "standard"} />
        <SetupRow label="Thinking summaries" value={thinkingSummaryLabel(session.request.agent_config)} />
        <SetupRow label="Previous interaction" value={session.request.previous_interaction_id ?? "none"} />
        <SetupRow
          label="System instruction"
          value={session.request.system_instruction ? "run override" : "inherits saved agent"}
        />
        <SetupRow label="Tools" value={toolsLabel(session.request.tools)} />
      </div>

      <div className="setup-block">
        <span className="setup-eyebrow">Agent snapshot</span>
        <SetupRow label="Agent id" value={agent?.id ?? session.agentId} />
        <SetupRow label="Base agent" value={agent?.base_agent ?? "unknown"} />
        <SetupRow label="Saved tools" value={toolsLabel(agent?.tools)} />
        <SetupRow label="Saved environment" value={environmentLabel(agent?.base_environment)} />
      </div>

      {tokens.length > 0 && (
        <div className="setup-block">
          <span className="setup-eyebrow">Token usage</span>
          <div className="token-grid">
            {tokens.map(([label, value]) => (
              <div className="token-cell" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="setup-raw">
        <button type="button" className="raw-toggle" onClick={() => setShowRequest((value) => !value)}>
          <ChevronRight size={12} className={showRequest ? "rot" : ""} /> Interaction request
        </button>
        {showRequest && <pre className="json-block">{JSON.stringify(session.request, null, 2)}</pre>}
        <button type="button" className="raw-toggle" onClick={() => setShowAgent((value) => !value)}>
          <ChevronRight size={12} className={showAgent ? "rot" : ""} /> Agent snapshot JSON
        </button>
        {showAgent && (
          <pre className="json-block">
            {JSON.stringify(
              agent ?? { id: session.agentId, note: "No agent snapshot stored for this run." },
              null,
              2
            )}
          </pre>
        )}
      </div>
    </div>
  );
};

const RawTab = ({
  interaction,
  events,
  onCopy
}: {
  interaction: Interaction | undefined;
  events: InteractionStreamEvent[];
  onCopy: (text: string, label: string) => void;
}) => {
  const eventsText = useMemo(() => events.map((event) => JSON.stringify(event)).join("\n"), [events]);
  const interactionText = useMemo(
    () => (interaction ? JSON.stringify(interaction, null, 2) : "// no interaction object returned yet"),
    [interaction]
  );

  return (
    <div className="raw">
      <div className="raw-section">
        <div className="raw-head">
          <span>Stream events ({events.length})</span>
          <button type="button" className="link-button" onClick={() => onCopy(eventsText, "Raw events")}>
            <Copy size={12} /> Copy
          </button>
        </div>
        {events.length > 0 ? (
          <pre className="json-block feed">{eventsText}</pre>
        ) : (
          <p className="raw-empty">No stream events captured for this run.</p>
        )}
      </div>
      <div className="raw-section">
        <div className="raw-head">
          <span>Interaction object</span>
          <button type="button" className="link-button" onClick={() => onCopy(interactionText, "Interaction JSON")}>
            <Copy size={12} /> Copy
          </button>
        </div>
        <pre className="json-block">{interactionText}</pre>
      </div>
    </div>
  );
};

export const RunView = ({
  session,
  turnNumber,
  view,
  focused,
  selected,
  hasBridge,
  busy,
  onFocusChange,
  onContinue,
  onFork,
  onSnapshot,
  onDelete,
  onInteractionUpdate,
  onCopy
}: {
  session: Session;
  turnNumber: number;
  view: ResultsView;
  focused: boolean;
  selected: boolean;
  hasBridge: boolean;
  busy: boolean;
  onFocusChange: (focused: boolean) => void;
  onContinue: (interactionId: string, agentId: string, environmentId?: string) => void;
  onFork: (environmentId: string) => void;
  onSnapshot: (environmentId: string) => void;
  onDelete: (session: Session) => void;
  onInteractionUpdate: (localId: string, interaction: Interaction) => void;
  onCopy: (text: string, label: string) => void;
}) => {
  const [setupOpen, setSetupOpen] = useState(false);
  const seedTerminal = isTerminal(session.seed);
  const { interaction, polling, error: pollError, stop } = useInteractionPoller(
    session.seed?.id,
    session.seed,
    hasBridge && Boolean(session.seed?.id) && !seedTerminal && !session.streaming
  );
  const lastSyncedInteractionRef = useRef("");

  const streaming = Boolean(session.streaming);
  const status: SessionStatus = streaming ? "running" : sessionStatus(interaction, polling);
  const meta = STATUS_META[status];
  const StatusIcon = meta.icon;

  const interactionId = interaction?.id ?? session.seed?.id;
  const environmentId = interaction?.environment_id ?? (session.seed?.environment_id as string | undefined);
  const error = session.error ?? pollError;
  const usage = interaction?.usage ?? session.seed?.usage;
  // Stable reference when absent so the buildTimeline useMemo isn't busted every render.
  const events = session.events ?? NO_EVENTS;

  const finished = status === "succeeded" || status === "failed";
  // Was this run already finished when the view first mounted? If so it came
  // from history and we show its start time; otherwise it ran live here and we
  // can report a real elapsed duration (captured once it reaches a terminal state).
  const startedTerminalRef = useRef<boolean | null>(null);
  if (startedTerminalRef.current === null) {
    startedTerminalRef.current = finished && !streaming;
  }
  const finishedAtRef = useRef<number | undefined>(undefined);
  if (finished && !startedTerminalRef.current && finishedAtRef.current === undefined) {
    finishedAtRef.current = Date.now();
  }
  const metaTime = startedTerminalRef.current
    ? formatStarted(session.startedAt)
    : formatDuration((finishedAtRef.current ?? Date.now()) - session.startedAt);
  const turnDuration = session.completedAt || finishedAtRef.current
    ? formatDuration(Math.max(0, (session.completedAt ?? finishedAtRef.current ?? session.startedAt) - session.startedAt))
    : finished
      ? "duration not recorded"
      : `${formatDuration(Date.now() - session.startedAt)} elapsed`;
  const source = interaction ?? session.seed;
  const items = useMemo(() => buildTimeline(source, events), [source, events]);
  const answerText = extractInteractionOutputText(source);
  useEffect(() => {
    if (!interaction || !isTerminal(interaction)) {
      return;
    }
    const signature = JSON.stringify({
      id: interaction.id,
      status: interaction.status,
      environment_id: interaction.environment_id,
      usage: interaction.usage,
      output_length: (extractInteractionOutputText(interaction) ?? "").length
    });
    if (lastSyncedInteractionRef.current === signature) {
      return;
    }
    lastSyncedInteractionRef.current = signature;
    onInteractionUpdate(session.localId, interaction);
  }, [interaction, onInteractionUpdate, session.localId]);

  const tokenTotal = compactTokens(usage?.total_tokens);
  const prompt = promptText(session) || "(empty prompt)";

  return (
    <div
      className={`run-view ${focused ? "focused" : ""} ${selected ? "selected" : ""} ${
        view === "raw" ? "raw-mode" : "chat-mode"
      }`}
      id={`run-${session.localId}`}
    >
      <div className="run-meta">
        <span className={`status-chip status-${status}`}>
          <StatusIcon size={13} className={meta.spin ? "spin" : undefined} />
          {streaming ? "Live" : meta.label}
        </span>
        <span className="turn-number">Turn {turnNumber}</span>
        {interactionId && (
          <button
            type="button"
            className="id-chip"
            title="Copy interaction id"
            onClick={() => onCopy(interactionId, "Interaction id")}
          >
            {interactionId}
          </button>
        )}
        <span className="run-duration">{metaTime}</span>
        {tokenTotal && <span className="run-tokens">{tokenTotal} tok</span>}

        <span className="meta-spacer" />

        <button
          type="button"
          className="chip-action focus-toggle"
          onClick={() => onFocusChange(!focused)}
          title={focused ? "Exit results focus" : "Focus results"}
        >
          {focused ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          {focused ? "Exit focus" : "Focus"}
        </button>
        {polling && (
          <button type="button" className="link-button" onClick={stop}>
            Stop polling
          </button>
        )}
        {view === "chat" && answerText && (
          <button
            type="button"
            className="chip-action"
            onClick={() => onCopy(answerText, "Answer")}
            title="Copy answer"
          >
            <Copy size={13} /> Copy
          </button>
        )}
        <button
          type="button"
          className={`chip-action ${setupOpen ? "active" : ""}`}
          onClick={() => setSetupOpen((value) => !value)}
          title="Show run setup"
        >
          <Info size={13} /> Setup
        </button>
        {interactionId && (
          <button
            type="button"
            className="chip-action accent"
            onClick={() => onContinue(interactionId, session.agentId, environmentId)}
            disabled={!finished || busy}
            title={finished ? "Continue this conversation in a new run" : "Wait for this run to finish"}
          >
            <CornerDownRight size={13} /> Continue
          </button>
        )}
        {environmentId && (
          <>
            <button
              type="button"
              className="chip-action"
              onClick={() => onFork(environmentId)}
              disabled={!finished || busy}
              title={finished ? "Fork environment into Configure" : "Wait for this run to finish"}
            >
              <GitFork size={13} /> Fork
            </button>
            <button
              type="button"
              className="chip-action"
              onClick={() => onSnapshot(environmentId)}
              disabled={!hasBridge || busy || !finished}
              title={finished ? "Download environment snapshot" : "Wait for this run to finish"}
            >
              <Download size={13} /> Snapshot
            </button>
          </>
        )}
        <button
          type="button"
          className="icon-button danger"
          title="Delete run"
          onClick={() => onDelete(session)}
          disabled={busy || !finished}
        >
          <Trash2 size={15} />
        </button>
      </div>

      {setupOpen && (
        <div className="turn-setup">
          <SetupTab session={session} usage={usage} />
        </div>
      )}

      {environmentId && (
        <div className="run-env">
          <button
            type="button"
            className="id-chip env"
            title="Copy environment id"
            onClick={() => onCopy(environmentId, "Environment id")}
          >
            env: {environmentId}
          </button>
        </div>
      )}

      {error && (
        <div className="run-error">
          <XCircle size={14} />
          <div>
            <strong>{error.name}</strong>
            <span>{error.message}</span>
            {error.errors?.length ? <pre className="json-block">{error.errors.join("\n")}</pre> : null}
          </div>
        </div>
      )}

      <div className="run-pane">
        {view === "chat" ? (
          <Transcript
            prompt={prompt}
            startedAt={session.startedAt}
            items={items}
            streaming={streaming || polling}
            embedded
            empty={
              status === "failed"
                ? "The run failed before producing output."
                : streaming || polling
                  ? "Working…"
                  : "No activity recorded for this run."
            }
            onCopy={onCopy}
          />
        ) : (
          <RawTab interaction={source} events={events} onCopy={onCopy} />
        )}
      </div>

      <div className={`turn-complete status-${status}`}>
        <strong>{turnDuration}</strong>
      </div>
    </div>
  );
};
