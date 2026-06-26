import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Braces, ChevronDown, Cog, History, MessageSquare, Play, Plus, Sparkles } from "lucide-react";
import type { Interaction } from "@sdk";
import type { ComposeState, Session } from "../lib/builderState";
import { sessionStatus, type SessionStatus } from "../lib/usePoller";
import { RunView, type ResultsView } from "./RunView";
import { Composer } from "./Composer";

type Mode = "runs" | "config";

const formatRunTime = (value: number): string =>
  new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const runPromptLabel = (session: Session): string => {
  if (typeof session.request.input === "string") {
    return session.request.input.trim() || "(empty prompt)";
  }
  return `${session.request.input.length} input part${session.request.input.length === 1 ? "" : "s"}`;
};

const runStatus = (session: Session): SessionStatus =>
  session.error ? "failed" : session.streaming ? "running" : sessionStatus(session.seed, false);

export const AgentWorkspace = ({
  agentId,
  empty = false,
  mode,
  onMode,
  runnable,
  blockedReason,
  configDirty,
  focusRunId,
  sessions,
  compose,
  setCompose,
  overrideToolTypes,
  autoPreviousInteractionId,
  autoEnvironmentId,
  running,
  hasBridge,
  busy,
  onRun,
  onContinue,
  onFork,
  onSnapshot,
  onCancel,
  onDelete,
  onInteractionUpdate,
  onCopy,
  onRenameAgentId,
  onNew,
  resultsFocus,
  onResultsFocus,
  configSlot
}: {
  agentId: string;
  empty?: boolean;
  mode: Mode;
  onMode: (mode: Mode) => void;
  runnable: boolean;
  blockedReason: string;
  configDirty: boolean;
  focusRunId: string | null;
  sessions: Session[];
  compose: ComposeState;
  setCompose: Dispatch<SetStateAction<ComposeState>>;
  overrideToolTypes: string[];
  autoPreviousInteractionId?: string;
  autoEnvironmentId?: string;
  running: boolean;
  hasBridge: boolean;
  busy: boolean;
  onRun: () => void;
  onContinue: (interactionId: string, agentId: string, environmentId?: string) => void;
  onFork: (environmentId: string) => void;
  onSnapshot: (environmentId: string) => void;
  onCancel: (session: Session) => void;
  onDelete: (session: Session) => void;
  onInteractionUpdate: (localId: string, interaction: Interaction) => void;
  onCopy: (text: string, label: string) => void;
  onRenameAgentId: (id: string) => void;
  onNew?: () => void;
  resultsFocus: boolean;
  onResultsFocus: (focused: boolean) => void;
  configSlot: ReactNode;
}) => {
  const [selectedId, setSelectedId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [resultsView, setResultsView] = useState<ResultsView>("chat");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(agentId);
  const renameRef = useRef<HTMLInputElement>(null);

  const chronologicalSessions = useMemo(
    () => [...sessions].sort((left, right) => left.startedAt - right.startedAt),
    [sessions]
  );
  const selected = useMemo(
    () => sessions.find((session) => session.localId === selectedId) ?? sessions[0],
    [selectedId, sessions]
  );
  const activeRun = useMemo(
    () =>
      sessions.find(
        (session) =>
          ["queued", "running"].includes(runStatus(session)) &&
          Boolean(session.seed?.id || session.streamId)
      ),
    [sessions]
  );
  const runLocked = running || sessions.some((session) => ["queued", "running"].includes(runStatus(session)));
  const rawEventCount = sessions.reduce((count, session) => count + (session.events?.length ?? 0), 0);

  useEffect(() => {
    if (!sessions.length) {
      if (selectedId) {
        setSelectedId("");
      }
      return;
    }
    if (!selectedId || !sessions.some((session) => session.localId === selectedId)) {
      setSelectedId(sessions[0].localId);
    }
  }, [selectedId, sessions]);

  // When a run is started/continued, focus it so the transcript shows it
  // instead of leaving the previously-selected run on screen.
  useEffect(() => {
    if (focusRunId && sessions.some((session) => session.localId === focusRunId)) {
      setSelectedId(focusRunId);
      window.requestAnimationFrame(() => {
        document.getElementById(`run-${focusRunId}`)?.scrollIntoView({ block: "end", behavior: "smooth" });
      });
    }
  }, [focusRunId, sessions.length]);

  // Don't leave the run picker hanging open across a mode switch.
  useEffect(() => {
    setPickerOpen(false);
  }, [mode]);

  useEffect(() => {
    if (runLocked) {
      setPickerOpen(false);
    }
  }, [runLocked]);

  useEffect(() => {
    if (!renaming) {
      setRenameValue(agentId);
    }
  }, [agentId, renaming]);

  useEffect(() => {
    if (renaming) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renaming]);

  const canRun =
    Boolean(agentId.trim()) &&
    runnable &&
    (compose.input.trim().length > 0 || compose.parts.some((part) => part.kind === "image"));
  const pickRunsMode = () => {
    if (runLocked) {
      return;
    }
    if (mode !== "runs") {
      onMode("runs");
    } else if (runnable && sessions.length > 0) {
      setPickerOpen((value) => !value);
    }
  };

  const beginRename = () => {
    if (runLocked) {
      return;
    }
    setRenameValue(agentId);
    setRenaming(true);
    onMode("config");
  };

  const commitRename = () => {
    setRenaming(false);
    if (renameValue.trim() !== agentId.trim()) {
      onRenameAgentId(renameValue.trim());
    }
  };

  if (empty) {
    return (
      <section className="workspace">
        <div className="ws-blank">
          <Sparkles size={26} />
          <p>No agent selected</p>
          <span>Select a saved agent from the sidebar or create a new draft.</span>
          {onNew && !resultsFocus && (
            <button type="button" className="primary-action" onClick={onNew} disabled={busy}>
              <Plus size={15} /> New draft
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="workspace">
      {!resultsFocus && (
        <header className="ws-head">
          <span className="ws-mark">
            <Sparkles size={15} />
          </span>
          {renaming ? (
            <input
              ref={renameRef}
              className="ws-id-input"
              value={renameValue}
              aria-label="Agent id"
              onChange={(event) => setRenameValue(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitRename();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setRenaming(false);
                  setRenameValue(agentId);
                }
              }}
            />
          ) : (
            <h2 className="ws-id" title="Double-click to rename" onDoubleClick={beginRename}>
              {agentId || "untitled-agent"}
            </h2>
          )}

          <div className="ws-modes">
            {mode === "runs" && runnable && sessions.length > 0 && (
              <div className="result-tabs" role="tablist" aria-label="Results view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={resultsView === "chat"}
                  className={resultsView === "chat" ? "ws-mode on" : "ws-mode"}
                  onClick={() => setResultsView("chat")}
                >
                  <MessageSquare size={14} />
                  Chat
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={resultsView === "raw"}
                  className={resultsView === "raw" ? "ws-mode on" : "ws-mode"}
                  onClick={() => setResultsView("raw")}
                >
                  <Braces size={14} />
                  Raw
                  {rawEventCount > 0 && <span className="ws-count">{rawEventCount}</span>}
                </button>
              </div>
            )}
            <div className="ws-runs">
              <button
                type="button"
                className={mode === "runs" ? "ws-mode on" : "ws-mode"}
                aria-pressed={mode === "runs"}
                disabled={runLocked}
                title={runLocked ? "Wait for the current run to finish" : undefined}
                onClick={pickRunsMode}
              >
                <History size={14} />
                Runs
                {sessions.length > 0 && <span className="ws-count">{sessions.length}</span>}
                {mode === "runs" && runnable && sessions.length > 0 && (
                  <ChevronDown size={13} className={pickerOpen ? "rot180" : ""} />
                )}
              </button>
              {pickerOpen && (
                <>
                  <div className="picker-backdrop" onClick={() => setPickerOpen(false)} />
                  <div className="run-picker" role="listbox">
                    {chronologicalSessions.map((session, index) => {
                      const status = runStatus(session);
                      return (
                        <button
                          type="button"
                          key={session.localId}
                          role="option"
                          aria-selected={session.localId === selected?.localId}
                          className={`run-picker-row ${session.localId === selected?.localId ? "selected" : ""}`}
                          disabled={runLocked}
                          onClick={() => {
                            setSelectedId(session.localId);
                            setPickerOpen(false);
                          }}
                        >
                          <span className={`run-dot status-${status}`} />
                          <strong>{index + 1}: {runPromptLabel(session)}</strong>
                          <span className="run-picker-time">{formatRunTime(session.startedAt)}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              className={mode === "config" ? "ws-mode on" : "ws-mode"}
              aria-pressed={mode === "config"}
              disabled={runLocked}
              title={runLocked ? "Wait for the current run to finish" : undefined}
              onClick={() => onMode("config")}
            >
              <Cog size={14} />
              Configure
              {configDirty && <span className="dirty-dot" title="Unsaved changes" />}
            </button>
          </div>
        </header>
      )}

      {mode === "config" ? (
        <div className="ws-config">{configSlot}</div>
      ) : runnable && sessions.length > 0 ? (
        <>
          <div className={`run-thread ${resultsView}`}>
            {chronologicalSessions.map((session, index) => (
              <RunView
                key={session.localId}
                session={session}
                turnNumber={index + 1}
                view={resultsView}
                focused={resultsFocus}
                selected={session.localId === selected?.localId}
                hasBridge={hasBridge}
                busy={busy}
                onFocusChange={onResultsFocus}
                onContinue={onContinue}
                onFork={onFork}
                onSnapshot={onSnapshot}
                onDelete={onDelete}
                onInteractionUpdate={onInteractionUpdate}
                onCopy={onCopy}
              />
            ))}
          </div>
          {!resultsFocus && (
            <Composer
              compose={compose}
              setCompose={setCompose}
              overrideToolTypes={overrideToolTypes}
              autoPreviousInteractionId={autoPreviousInteractionId}
              autoEnvironmentId={autoEnvironmentId}
              running={running}
              locked={runLocked}
              canRun={canRun}
              canCancel={Boolean(activeRun)}
              cancelDisabled={!hasBridge}
              onRun={onRun}
              onCancel={() => {
                if (activeRun) {
                  onCancel(activeRun);
                }
              }}
            />
          )}
        </>
      ) : runnable ? (
        <>
          <div className="ws-blank">
            <Play size={26} />
            <p>No runs yet</p>
            <span>Send the first prompt below to run this agent.</span>
          </div>
          <Composer
            compose={compose}
            setCompose={setCompose}
            overrideToolTypes={overrideToolTypes}
            autoPreviousInteractionId={autoPreviousInteractionId}
            autoEnvironmentId={autoEnvironmentId}
            running={running}
            locked={runLocked}
            canRun={canRun}
            canCancel={Boolean(activeRun)}
            cancelDisabled={!hasBridge}
            onRun={onRun}
            onCancel={() => {
              if (activeRun) {
                onCancel(activeRun);
              }
            }}
          />
        </>
      ) : (
        <div className="ws-blank">
          <Cog size={26} />
          <p>Not ready to run</p>
          <span>{blockedReason}</span>
          <button type="button" className="primary-action" onClick={() => onMode("config")}>
            <Plus size={15} /> Open Configure
          </button>
        </div>
      )}
    </section>
  );
};
