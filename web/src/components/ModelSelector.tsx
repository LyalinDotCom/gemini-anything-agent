import { HARNESS_MODELS, isHarnessModel, type HarnessModel } from "../models";
import { T } from "../tokens";

export function ModelSelector({ value, disabled, onChange }: {
  value: HarnessModel;
  disabled: boolean;
  onChange: (model: HarnessModel) => void;
}) {
  return <select
    aria-label="Reasoning model"
    title="Model used by the managed agent"
    value={value}
    disabled={disabled}
    onChange={event => { if (isHarnessModel(event.target.value)) onChange(event.target.value); }}
    style={{ height: 32, maxWidth: "100%", padding: "0 8px", borderRadius: T.radiusSm,
      border: `1px solid ${T.borderSoft}`, background: T.bgElev, color: T.textDim,
      fontSize: 12.5, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1 }}
  >
    {HARNESS_MODELS.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
  </select>;
}
