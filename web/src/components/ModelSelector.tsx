import { useId } from "react";
import { HARNESS_MODELS, isHarnessModel, type HarnessModel } from "../models";
import { T } from "../tokens";

export function modelSelectionLocked(session: { modelUsed?: string; messageCount?: number; lastInteractionId?: string | null; environmentId?: string | null; pending?: unknown }, messageCount: number): boolean {
  return messageCount > 0 || (session.messageCount ?? 0) > 0 || Boolean(session.modelUsed || session.lastInteractionId || session.environmentId || session.pending);
}

export function ModelSelector({ value, disabled, locked = false, onChange }: {
  value: HarnessModel;
  disabled: boolean;
  locked?: boolean;
  onChange: (model: HarnessModel) => void;
}) {
  const hintId = useId();
  return <><select
    aria-label="Reasoning model"
    aria-describedby={locked ? hintId : undefined}
    title={locked ? "Start a new chat to choose a different model." : "Model used by the managed agent"}
    value={value}
    disabled={disabled || locked}
    onChange={event => { if (!disabled && !locked && isHarnessModel(event.target.value)) onChange(event.target.value); }}
    style={{ height: 32, maxWidth: "100%", padding: "0 8px", borderRadius: T.radiusSm,
      border: `1px solid ${T.borderSoft}`, background: T.bgElev, color: T.textDim,
      fontSize: 12.5, cursor: disabled || locked ? "default" : "pointer", opacity: disabled || locked ? 0.55 : 1 }}
  >
    {HARNESS_MODELS.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
  </select>{locked && <span id={hintId} style={{fontSize:11,color:T.textFaint}}>New chat to change model</span>}</>;
}
