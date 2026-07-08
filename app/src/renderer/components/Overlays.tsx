import { useState } from "react";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  ShieldAlert,
  Trash2,
  X
} from "lucide-react";
import type { RuntimeConfig } from "../../shared/electron-api";

export const SettingsModal = ({
  runtime,
  hasBridge,
  saving,
  onClose,
  onSave,
  onClear
}: {
  runtime: RuntimeConfig | null;
  hasBridge: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (key: string) => Promise<boolean>;
  onClear: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);

  const masked = runtime?.apiKeyMasked;

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div
        className="modal settings-modal"
        role="dialog"
        aria-modal
        aria-label="Settings"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div className="modal-title">
            <KeyRound size={18} />
            <h2>Settings</h2>
          </div>
          <button type="button" className="ghost-button sm" onClick={onClose}>
            <X size={16} />
            Close
          </button>
        </header>

        <div className="modal-body">
          <section className="settings-card">
            <h3>Gemini API key</h3>
            {!editing ? (
              <div className="key-status">
                <span className={`status-dot ${runtime?.hasApiKey ? "ok" : "warn"}`} />
                <code>{masked ?? "No key set"}</code>
                <div className="row-actions">
                  <button type="button" className="ghost-button sm" onClick={() => setEditing(true)} disabled={!hasBridge}>
                    <Pencil size={13} /> {runtime?.hasApiKey ? "Update" : "Set key"}
                  </button>
                  {runtime?.hasApiKey && (
                    <button type="button" className="ghost-button sm danger" onClick={onClear} disabled={!hasBridge}>
                      <Trash2 size={13} /> Delete
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="key-edit">
                <div className="key-input">
                  <input
                    type={reveal ? "text" : "password"}
                    value={value}
                    autoFocus
                    spellCheck={false}
                    placeholder="Paste your Gemini API key"
                    onChange={(event) => setValue(event.target.value)}
                  />
                  <button type="button" onClick={() => setReveal((r) => !r)} title={reveal ? "Hide" : "Show"}>
                    {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="primary-action sm"
                    disabled={saving || !value.trim()}
                    onClick={async () => {
                      const ok = await onSave(value.trim());
                      if (ok) {
                        setValue("");
                        setEditing(false);
                        setReveal(false);
                      }
                    }}
                  >
                    {saving ? <Loader2 className="spin" size={14} /> : null}
                    Save key
                  </button>
                  <button
                    type="button"
                    className="ghost-button sm"
                    onClick={() => {
                      setEditing(false);
                      setValue("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <p className="warn-banner">
              <ShieldAlert size={14} />
              Stored in plaintext in <code>{runtime?.envPath ?? ".env"}</code>. It's gitignored — don't commit it.
            </p>

            {!hasBridge && (
              <p className="inline-note warn">
                <AlertTriangle size={12} /> Web preview — run the Electron app to change the key.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
