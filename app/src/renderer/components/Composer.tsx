import { useState, type Dispatch, type SetStateAction } from "react";
import {
  AlertTriangle,
  ChevronRight,
  CornerDownRight,
  ImagePlus,
  Loader2,
  Play,
  Server,
  Sliders,
  Trash2,
  XCircle
} from "lucide-react";
import { uid, type ComposeState, type ImagePartDraft } from "../lib/builderState";
import { IconButton, TextArea, TextField, Toggle } from "./primitives";

type Setter = Dispatch<SetStateAction<ComposeState>>;

const readImage = (file: File): Promise<ImagePartDraft> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve({
        id: uid(),
        kind: "image",
        data: comma >= 0 ? result.slice(comma + 1) : result,
        mimeType: file.type || "application/octet-stream",
        name: file.name,
        bytes: file.size
      });
    };
    reader.readAsDataURL(file);
  });

export const Composer = ({
  compose,
  setCompose,
  overrideToolTypes,
  autoPreviousInteractionId,
  autoEnvironmentId,
  running,
  locked,
  canRun,
  canCancel,
  cancelDisabled,
  onRun,
  onCancel
}: {
  compose: ComposeState;
  setCompose: Setter;
  overrideToolTypes: string[];
  autoPreviousInteractionId?: string;
  autoEnvironmentId?: string;
  running: boolean;
  locked: boolean;
  canRun: boolean;
  canCancel: boolean;
  cancelDisabled?: boolean;
  onRun: () => void;
  onCancel: () => void;
}) => {
  const [showOptions, setShowOptions] = useState(false);
  const explicitPreviousInteractionId = compose.previousInteractionId.trim();
  const manualEnvironment = compose.overrideEnvironment && compose.environmentId.trim();
  const conversationEnabled = compose.store && (compose.autoContinue || Boolean(explicitPreviousInteractionId));
  const reusingLatestEnvironment = compose.reuseEnvironment && !manualEnvironment && autoEnvironmentId;
  const imageParts = compose.parts.filter((part): part is ImagePartDraft => part.kind === "image");
  const optionCount =
    (compose.overrideSystemInstruction ? 1 : 0) +
    (compose.overrideTools ? 1 : 0) +
    (compose.overrideEnvironment ? 1 : 0) +
    (explicitPreviousInteractionId ? 1 : 0) +
    (!compose.store ? 1 : 0) +
    (!compose.background ? 1 : 0) +
    (compose.serviceTier !== "standard" ? 1 : 0) +
    (compose.thinkingSummaries !== "none" ? 1 : 0);

  const submitOnEnter = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey && canRun && !locked) {
      event.preventDefault();
      onRun();
    }
  };
  const cancelMode = locked && canCancel;
  const addImages = async (files: FileList | null) => {
    if (!files?.length) {
      return;
    }
    const images = await Promise.all(Array.from(files).map(readImage));
    setCompose((current) => ({ ...current, inputMode: "string", parts: [...current.parts, ...images] }));
  };
  const toggleConversation = () =>
    setCompose((current) =>
      current.previousInteractionId.trim() || current.autoContinue
        ? { ...current, previousInteractionId: "", autoContinue: false }
        : { ...current, store: true, autoContinue: true }
    );

  return (
    <div className="composer">
      <div className="composer-field" onKeyDown={submitOnEnter}>
        <TextArea
          value={compose.input}
          rows={2}
          placeholder="Ask the agent to do something…  (Enter to run, Shift+Enter for newline)"
          disabled={locked}
          onChange={(input) => setCompose((current) => ({ ...current, inputMode: "string", input }))}
        />
        {imageParts.length > 0 && (
          <div className="attachment-list">
            {imageParts.map((part) => (
              <div className="attachment-chip" key={part.id}>
                <ImagePlus size={13} />
                <span title={part.name}>{part.name}</span>
                <em>{Math.round(part.bytes / 1024)} KB</em>
                <IconButton
                  title={`Remove ${part.name}`}
                  tone="danger"
                  disabled={locked}
                  onClick={() => {
                    if (!window.confirm(`Remove attachment "${part.name}"?`)) {
                      return;
                    }
                    setCompose((current) => ({ ...current, parts: current.parts.filter((item) => item.id !== part.id) }));
                  }}
                >
                  <Trash2 size={13} />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="composer-row">
        <label
          className={`icon-toggle as-file ${imageParts.length ? "on" : ""} ${locked ? "disabled" : ""}`}
          title={locked ? "Wait for the current run to finish" : "Attach one or more images"}
          aria-label="Attach images"
        >
          <ImagePlus size={15} />
          {imageParts.length > 0 && <span>{imageParts.length}</span>}
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={locked}
            hidden
            onChange={(event) => {
              const files = event.target.files;
              event.target.value = "";
              void addImages(files);
            }}
          />
        </label>
        <button
          type="button"
          className={`icon-toggle ${conversationEnabled ? "on" : ""}`}
          disabled={locked}
          aria-pressed={conversationEnabled}
          title={
            explicitPreviousInteractionId
              ? `Continuing ${explicitPreviousInteractionId}. Click to start a new conversation.`
              : conversationEnabled
                ? autoPreviousInteractionId
                  ? `Continue latest stored conversation ${autoPreviousInteractionId}.`
                  : "Continue the latest stored conversation when one exists."
                : "Start a new conversation instead of continuing history."
          }
          onClick={toggleConversation}
        >
          <CornerDownRight size={15} />
        </button>
        <button
          type="button"
          className={`icon-toggle ${compose.reuseEnvironment ? "on" : ""}`}
          disabled={locked}
          aria-pressed={compose.reuseEnvironment}
          title={
            compose.reuseEnvironment
              ? reusingLatestEnvironment
                ? `Reuse latest environment ${autoEnvironmentId}.`
                : "Reuse the latest environment when one exists."
              : "Use a fresh remote environment for the next run."
          }
          onClick={() => setCompose((current) => ({ ...current, reuseEnvironment: !current.reuseEnvironment }))}
        >
          <Server size={15} />
        </button>

        <button
          type="button"
          className={`run-options ${optionCount ? "active" : ""}`}
          disabled={locked}
          onClick={() => setShowOptions((value) => !value)}
        >
          <Sliders size={13} />
          Options{optionCount ? ` · ${optionCount}` : ""}
          <ChevronRight size={13} className={showOptions ? "rot" : ""} />
        </button>

        <button
          type="button"
          className={`primary-action run ${cancelMode ? "cancel" : ""}`}
          disabled={cancelMode ? cancelDisabled : !canRun || locked}
          onClick={cancelMode ? onCancel : onRun}
          title={cancelMode && cancelDisabled ? "Run the Electron app to cancel" : undefined}
        >
          {cancelMode ? <XCircle size={15} /> : running ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
          {cancelMode ? "Cancel" : "Run"}
        </button>
      </div>

      {showOptions && (
        <div className="run-options-panel">
          <p className="inline-note">One-off overrides for this run only. Off = inherits from the saved agent.</p>
          <Toggle
            checked={compose.store}
            label="Store interaction history"
            disabled={locked}
            onChange={(store) =>
              setCompose((current) => ({
                ...current,
                store,
                autoContinue: store ? current.autoContinue : false,
                background: store ? current.background : false
              }))
            }
          />
          <Toggle
            checked={compose.background && compose.store}
            label="Background execution"
            disabled={locked || !compose.store}
            onChange={(background) => setCompose((current) => ({ ...current, background }))}
          />
          {!compose.store && (
            <p className="inline-note warn">
              <AlertTriangle size={12} /> Background runs require Persistence on.
            </p>
          )}
          <label className="field">
            <span className="field-label">Service tier</span>
            <select
              value={compose.serviceTier}
              disabled={locked}
              onChange={(event) =>
                setCompose((current) => ({
                  ...current,
                  serviceTier: event.target.value as typeof current.serviceTier
                }))
              }
            >
              <option value="standard">Standard</option>
              <option value="flex">Flex</option>
              <option value="priority">Priority</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Thinking summaries</span>
            <select
              value={compose.thinkingSummaries}
              disabled={locked}
              onChange={(event) =>
                setCompose((current) => ({
                  ...current,
                  thinkingSummaries: event.target.value as typeof current.thinkingSummaries
                }))
              }
            >
              <option value="none">Off</option>
              <option value="auto">Auto</option>
            </select>
          </label>
          <Toggle
            checked={compose.overrideSystemInstruction}
            label="Override system instruction"
            disabled={locked}
            onChange={(value) => setCompose((current) => ({ ...current, overrideSystemInstruction: value }))}
          />
          {compose.overrideSystemInstruction && (
            <TextArea
              value={compose.systemInstruction}
              rows={3}
              placeholder="One-off instruction for this run…"
              disabled={locked}
              onChange={(systemInstruction) => setCompose((current) => ({ ...current, systemInstruction }))}
            />
          )}
          <Toggle
            checked={compose.overrideTools}
            label="Override tools (uses the Configure tool selection)"
            disabled={locked}
            onChange={(value) => setCompose((current) => ({ ...current, overrideTools: value }))}
          />
          {compose.overrideTools &&
            (overrideToolTypes.length === 0 ? (
              <p className="inline-note warn">
                <AlertTriangle size={12} /> No tools selected — this run sends an empty list, turning ALL tools OFF.
              </p>
            ) : (
              <p className="inline-note">
                Sending {overrideToolTypes.join(", ")} ({overrideToolTypes.length}/3).
              </p>
            ))}
          <Toggle
            checked={compose.overrideEnvironment}
            label="Use existing environment id"
            disabled={locked}
            onChange={(value) => setCompose((current) => ({ ...current, overrideEnvironment: value }))}
          />
          {compose.overrideEnvironment && (
            <TextField
              label="Environment id"
              value={compose.environmentId}
              mono
              placeholder="env-…"
              disabled={locked}
              onChange={(environmentId) => setCompose((current) => ({ ...current, environmentId }))}
            />
          )}
          <TextField
            label="Previous interaction id (continue a conversation)"
            value={compose.previousInteractionId}
            mono
            disabled={locked}
            onChange={(previousInteractionId) =>
              setCompose((current) => ({ ...current, previousInteractionId, autoContinue: false }))
            }
          />
        </div>
      )}
    </div>
  );
};
