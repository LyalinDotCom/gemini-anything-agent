import type { ClipboardEventHandler, ReactNode, Ref } from "react";
import { Loader2 } from "lucide-react";

export const TextField = ({
  label,
  value,
  onChange,
  placeholder,
  readOnly = false,
  disabled = false,
  hint,
  meter,
  mono = false
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  hint?: string;
  meter?: string;
  mono?: boolean;
}) => (
  <label className="field">
    <span className="field-label">
      {label}
      {meter && <em className="field-meter">{meter}</em>}
    </span>
    <input
      value={value}
      placeholder={placeholder}
      readOnly={readOnly}
      disabled={disabled}
      spellCheck={false}
      className={mono ? "mono" : undefined}
      onChange={(event) => onChange?.(event.target.value)}
    />
    {hint && <small className="field-hint">{hint}</small>}
  </label>
);

export const TextArea = ({
  label,
  value,
  onChange,
  rows,
  placeholder,
  hint,
  disabled = false,
  mono = false,
  textareaRef,
  onPaste
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  mono?: boolean;
  textareaRef?: Ref<HTMLTextAreaElement>;
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
}) => (
  <label className="field">
    {label && <span className="field-label">{label}</span>}
    <textarea
      ref={textareaRef}
      value={value}
      rows={rows}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      className={mono ? "mono" : undefined}
      onPaste={onPaste}
      onChange={(event) => onChange(event.target.value)}
    />
    {hint && <small className="field-hint">{hint}</small>}
  </label>
);

export const Segmented = <T extends string>({
  value,
  options,
  onChange
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) => (
  <div className="segmented" role="tablist">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="tab"
        aria-selected={option.value === value}
        className={option.value === value ? "selected" : ""}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
);

export const Toggle = ({
  checked,
  label,
  disabled = false,
  onChange
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <label className={`toggle ${checked ? "on" : ""} ${disabled ? "disabled" : ""}`}>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span className="toggle-track" aria-hidden>
      <span className="toggle-thumb" />
    </span>
    {label}
  </label>
);

export const IconButton = ({
  title,
  children,
  onClick,
  busy = false,
  disabled = false,
  tone = "neutral"
}: {
  title: string;
  children: ReactNode;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "neutral" | "danger";
}) => (
  <button
    type="button"
    className={`icon-button ${tone === "danger" ? "danger" : ""}`}
    title={title}
    aria-label={title}
    disabled={disabled || busy}
    onClick={onClick}
  >
    {busy ? <Loader2 className="spin" size={16} /> : children}
  </button>
);

export const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <div className="field">
    <span className="field-label">{label}</span>
    {children}
    {hint && <small className="field-hint">{hint}</small>}
  </div>
);
