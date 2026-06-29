import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  AlertTriangle,
  ChevronRight,
  ImagePlus,
  Loader2,
  Play,
  Sliders,
  X,
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
      const electronPath = (file as File & { path?: unknown }).path;
      const bridgedPath = window.managedAgents?.getPathForFile?.(file);
      resolve({
        id: uid(),
        kind: "image",
        data: comma >= 0 ? result.slice(comma + 1) : result,
        mimeType: file.type || "application/octet-stream",
        name: file.name,
        path:
          bridgedPath ||
          (typeof electronPath === "string" && electronPath ? electronPath : file.webkitRelativePath || undefined),
        bytes: file.size
      });
    };
    reader.readAsDataURL(file);
  });

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const imagePreviewSrc = (part: ImagePartDraft): string => `data:${part.mimeType};base64,${part.data}`;

const imageTooltip = (part: ImagePartDraft): string =>
  [part.name, part.path, formatBytes(part.bytes)].filter(Boolean).join("\n");

export const Composer = ({
  compose,
  setCompose,
  overrideToolTypes,
  autoPreviousInteractionId,
  autoEnvironmentId,
  sentImageParts = [],
  running,
  locked,
  canRun,
  canCancel,
  cancelDisabled,
  onRun,
  onCancel,
  onAttachmentError
}: {
  compose: ComposeState;
  setCompose: Setter;
  overrideToolTypes: string[];
  autoPreviousInteractionId?: string;
  autoEnvironmentId?: string;
  sentImageParts?: ImagePartDraft[];
  running: boolean;
  locked: boolean;
  canRun: boolean;
  canCancel: boolean;
  cancelDisabled?: boolean;
  onRun: () => void;
  onCancel: () => void;
  onAttachmentError?: (message: string) => void;
}) => {
  const [showOptions, setShowOptions] = useState(false);
  const disabledPreviousInteractionId = useRef<string | undefined>(undefined);
  const disabledEnvironmentId = useRef<string | undefined>(undefined);
  const disabledEnvironmentWasSpecific = useRef(false);
  const disabledBackgroundWasEnabled = useRef(false);
  const rememberedAutoPreviousInteractionId = useRef<string | undefined>(undefined);
  const rememberedAutoEnvironmentId = useRef<string | undefined>(undefined);
  const rememberedSpecificEnvironmentId = useRef<string | undefined>(undefined);
  const explicitPreviousInteractionId = compose.previousInteractionId.trim();
  const manualEnvironment = compose.overrideEnvironment && compose.environmentId.trim();
  const conversationEnabled = compose.store && (compose.autoContinue || Boolean(explicitPreviousInteractionId));
  const reusingLatestEnvironment = compose.reuseEnvironment && !manualEnvironment && autoEnvironmentId;
  const contextOverrideCount = explicitPreviousInteractionId ? 1 : compose.store && !compose.autoContinue ? 1 : 0;
  const environmentOverrideCount = compose.overrideEnvironment ? 1 : !compose.reuseEnvironment ? 1 : 0;
  const imageParts = compose.parts.filter((part): part is ImagePartDraft => part.kind === "image");
  const attachedImageCount = sentImageParts.length + imageParts.length;
  const optionCount =
    (compose.overrideSystemInstruction ? 1 : 0) +
    (compose.overrideTools ? 1 : 0) +
    contextOverrideCount +
    environmentOverrideCount +
    (!compose.store ? 1 : 0) +
    (!compose.background ? 1 : 0) +
    (compose.serviceTier !== "standard" ? 1 : 0) +
    (compose.thinkingSummaries !== "none" ? 1 : 0);

  useEffect(() => {
    if (autoPreviousInteractionId) {
      rememberedAutoPreviousInteractionId.current = autoPreviousInteractionId;
    }
  }, [autoPreviousInteractionId]);

  useEffect(() => {
    if (autoEnvironmentId) {
      rememberedAutoEnvironmentId.current = autoEnvironmentId;
    }
  }, [autoEnvironmentId]);

  useEffect(() => {
    const environmentId = compose.environmentId.trim();
    if (environmentId) {
      rememberedSpecificEnvironmentId.current = environmentId;
    }
  }, [compose.environmentId]);

  const submitOnEnter = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey && canRun && !locked) {
      event.preventDefault();
      onRun();
    }
  };
  const cancelMode = locked && canCancel;
  const addImages = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    const results = await Promise.allSettled(files.map(readImage));
    const images = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const failed = results.length - images.length;
    if (images.length > 0) {
      setCompose((current) => ({ ...current, inputMode: "string", parts: [...current.parts, ...images] }));
    }
    if (failed > 0) {
      onAttachmentError?.(
        `${failed} image${failed === 1 ? "" : "s"} could not be attached. ${images.length} attached successfully.`
      );
    }
  };
  const removeImage = (part: ImagePartDraft) => {
    if (!window.confirm(`Remove attachment "${part.name}"?`)) {
      return;
    }
    setCompose((current) => ({ ...current, parts: current.parts.filter((item) => item.id !== part.id) }));
  };
  const clearImages = () => {
    if (!window.confirm(`Remove ${imageParts.length} attached image${imageParts.length === 1 ? "" : "s"}?`)) {
      return;
    }
    setCompose((current) => ({ ...current, parts: current.parts.filter((item) => item.kind !== "image") }));
  };
  const setStoreHistory = (store: boolean) =>
    setCompose((current) => {
      const currentPrevious = current.previousInteractionId.trim();
      if (!store) {
        disabledPreviousInteractionId.current =
          currentPrevious || autoPreviousInteractionId || rememberedAutoPreviousInteractionId.current;
        disabledBackgroundWasEnabled.current = current.background;
        return {
          ...current,
          store: false,
          autoContinue: false,
          previousInteractionId: "",
          background: false
        };
      }

      const restoredPrevious =
        disabledPreviousInteractionId.current ||
        currentPrevious ||
        autoPreviousInteractionId ||
        rememberedAutoPreviousInteractionId.current ||
        "";
      disabledPreviousInteractionId.current = undefined;
      return {
        ...current,
        store: true,
        autoContinue: !restoredPrevious,
        previousInteractionId: restoredPrevious,
        background: current.background || disabledBackgroundWasEnabled.current
      };
    });

  const setContinueChatContext = (autoContinue: boolean) =>
    setCompose((current) => {
      const currentPrevious = current.previousInteractionId.trim();
      if (!autoContinue) {
        disabledPreviousInteractionId.current =
          currentPrevious || autoPreviousInteractionId || rememberedAutoPreviousInteractionId.current;
        return {
          ...current,
          autoContinue: false,
          previousInteractionId: ""
        };
      }

      const restoredPrevious =
        disabledPreviousInteractionId.current ||
        currentPrevious ||
        autoPreviousInteractionId ||
        rememberedAutoPreviousInteractionId.current ||
        "";
      disabledPreviousInteractionId.current = undefined;
      return {
        ...current,
        store: true,
        autoContinue: !restoredPrevious,
        previousInteractionId: restoredPrevious
      };
    });

  const setReuseSandboxEnvironment = (reuseEnvironment: boolean) =>
    setCompose((current) => {
      const currentSpecificEnvironment = current.overrideEnvironment ? current.environmentId.trim() : "";
      if (!reuseEnvironment) {
        disabledEnvironmentId.current =
          currentSpecificEnvironment ||
          autoEnvironmentId ||
          rememberedAutoEnvironmentId.current ||
          rememberedSpecificEnvironmentId.current;
        disabledEnvironmentWasSpecific.current = Boolean(currentSpecificEnvironment);
        if (current.environmentId.trim()) {
          rememberedSpecificEnvironmentId.current = current.environmentId.trim();
        }
        return {
          ...current,
          reuseEnvironment: false,
          overrideEnvironment: false
        };
      }

      const restoredEnvironment =
        disabledEnvironmentId.current ||
        current.environmentId.trim() ||
        autoEnvironmentId ||
        rememberedAutoEnvironmentId.current ||
        rememberedSpecificEnvironmentId.current ||
        "";
      const restoreSpecificEnvironment = Boolean(
        restoredEnvironment && (disabledEnvironmentWasSpecific.current || (!autoEnvironmentId && !rememberedAutoEnvironmentId.current))
      );
      disabledEnvironmentId.current = undefined;
      disabledEnvironmentWasSpecific.current = false;
      return {
        ...current,
        reuseEnvironment: true,
        overrideEnvironment: restoreSpecificEnvironment ? true : current.overrideEnvironment,
        environmentId: restoreSpecificEnvironment ? restoredEnvironment : current.environmentId
      };
    });

  const setSpecificEnvironment = (overrideEnvironment: boolean) =>
    setCompose((current) => {
      if (!overrideEnvironment) {
        const environmentId = current.environmentId.trim();
        if (environmentId) {
          rememberedSpecificEnvironmentId.current = environmentId;
        }
        return { ...current, overrideEnvironment: false };
      }

      const restoredEnvironment =
        current.environmentId.trim() ||
        rememberedSpecificEnvironmentId.current ||
        disabledEnvironmentId.current ||
        autoEnvironmentId ||
        rememberedAutoEnvironmentId.current ||
        "";
      return {
        ...current,
        reuseEnvironment: true,
        overrideEnvironment: true,
        environmentId: restoredEnvironment
      };
    });

  return (
    <div className="composer">
      {attachedImageCount > 0 && (
        <div className="attachment-tray" aria-label="Attached images">
          <div className="attachment-tray-header">
            <span>
              {attachedImageCount} image{attachedImageCount === 1 ? "" : "s"}
              {sentImageParts.length > 0 && imageParts.length > 0
                ? ` · ${sentImageParts.length} sent, ${imageParts.length} pending`
                : sentImageParts.length > 0
                  ? " · sent"
                  : " · pending"}
            </span>
            {imageParts.length > 0 && (
              <button type="button" disabled={locked} onClick={clearImages}>
                Clear
              </button>
            )}
          </div>
          <div className="attachment-list">
            {sentImageParts.map((part) => (
              <div className="attachment-thumb sent" key={`sent-${part.id}`} title={`${imageTooltip(part)}\nAlready sent`}>
                <img src={imagePreviewSrc(part)} alt={`${part.name} preview`} />
              </div>
            ))}
            {imageParts.map((part) => (
              <div className="attachment-thumb" key={part.id} title={imageTooltip(part)}>
                <img src={imagePreviewSrc(part)} alt={`${part.name} preview`} />
                <IconButton
                  title={`Remove ${part.name}`}
                  tone="danger"
                  disabled={locked}
                  onClick={() => removeImage(part)}
                >
                  <X size={12} />
                </IconButton>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="composer-field" onKeyDown={submitOnEnter}>
        <TextArea
          value={compose.input}
          rows={2}
          placeholder="Ask the agent to do something…  (Enter to run, Shift+Enter for newline)"
          disabled={locked}
          onChange={(input) => setCompose((current) => ({ ...current, inputMode: "string", input }))}
        />
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
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void addImages(files);
            }}
          />
        </label>
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
          <p className="inline-note">Run controls. Defaults keep chat context and sandbox continuity on.</p>
          <Toggle
            checked={compose.store}
            label="Store interaction history"
            disabled={locked}
            onChange={setStoreHistory}
          />
          <Toggle
            checked={conversationEnabled}
            label="Continue chat context"
            disabled={locked || !compose.store}
            onChange={setContinueChatContext}
          />
          {conversationEnabled && (
            <p className="inline-note">
              {explicitPreviousInteractionId
                ? `Continuing ${explicitPreviousInteractionId}.`
                : autoPreviousInteractionId
                  ? `Continuing latest chat context ${autoPreviousInteractionId}.`
                  : "Will continue the latest chat context when one exists."}
            </p>
          )}
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
          <Toggle
            checked={compose.reuseEnvironment}
            label="Reuse sandbox environment"
            disabled={locked}
            onChange={setReuseSandboxEnvironment}
          />
          {compose.reuseEnvironment && (
            <p className="inline-note">
              {manualEnvironment
                ? "A specific environment id below overrides latest-environment reuse."
                : reusingLatestEnvironment
                  ? `Reusing latest sandbox ${autoEnvironmentId}.`
                  : "Will reuse the latest sandbox when one exists."}
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
            label="Use specific environment id"
            disabled={locked}
            onChange={setSpecificEnvironment}
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
            label="Specific previous interaction id"
            value={compose.previousInteractionId}
            mono
            disabled={locked}
            onChange={(previousInteractionId) =>
              setCompose((current) => {
                const value = previousInteractionId.trim();
                if (value) {
                  disabledPreviousInteractionId.current = value;
                }
                return { ...current, previousInteractionId, autoContinue: false };
              })
            }
          />
        </div>
      )}
    </div>
  );
};
