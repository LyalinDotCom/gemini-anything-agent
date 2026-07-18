import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Eye,
  EyeOff,
  ExternalLink,
  Info,
  KeyRound,
  Loader2,
  Monitor,
  Pencil,
  ShieldAlert,
  Terminal,
  Trash2,
  X
} from "lucide-react";
import type { RuntimeConfig } from "../../shared/electron-api";

const REPO_URL = "https://github.com/LyalinDotCom/gemini-anything-agent/";

const solutionParts = [
  {
    title: "Test app",
    eyebrow: "Electron chat harness",
    icon: Monitor,
    summary: "A local control surface for exercising real managed-agent runs with visibility into prompts, events, artifacts, and continuity.",
    features: [
      "Stored chat chains and sandbox reuse",
      "Per-chat Antigravity, Browser, and Deep Research modes",
      "Timeline for commands, search, URLs, and outputs",
      "Output drawer for media, HTML, Markdown, and text"
    ]
  },
  {
    title: "Agent",
    eyebrow: "Managed Antigravity profiles",
    icon: Bot,
    summary: "A hosted Linux sandbox running the shared `agents/` payload, with native tools and artifact conventions.",
    features: [
      "Antigravity and Browser profiles with code, search, and URL tools",
      "Mounts the shared AGENTS.md, skills, launchers, and sandbox .env",
      "Keeps coding, research, and file work native",
      "Writes user-facing artifacts to /workspace/output"
    ]
  },
  {
    title: "gai CLI",
    eyebrow: "Scoped npm capability layer",
    icon: Terminal,
    summary: "A published command-line surface the agent invokes only for media and adjacent Gemini utility capabilities.",
    features: [
      "`/.agents/bin/gai` resolves the scoped npm package",
      "Images, video, speech, music, and transcripts",
      "Embeddings, tokens, files, and agent orchestration",
      "--help discovery avoids wrapper and model-flag drift"
    ]
  }
];

const collaborationSteps = [
  "The app deploys selectable Antigravity and Browser managed-agent profiles from the same shared `agents/` folder and streams every turn back into the UI.",
  "The agent handles normal work with native tools, filesystem state, and the `/workspace/output` artifact contract.",
  "When media or Gemini utility work is needed, the agent shells out to `bash /.agents/bin/gai`, which resolves the latest scoped npm CLI.",
  "In Browser mode, the agent uses `bash /.agents/bin/browser` for real headless navigation, interaction, and test evidence.",
  "Generated artifacts land in the sandbox output folder; the app pulls, caches, previews, and saves them locally."
];

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

export const AboutModal = ({
  onClose,
  onOpenExternal
}: {
  onClose: () => void;
  onOpenExternal: (url: string) => void | Promise<void>;
}) => (
  <div className="overlay-backdrop" onClick={onClose}>
    <div
      className="modal about-modal"
      role="dialog"
      aria-modal
      aria-label="About Gemini Anything"
      onClick={(event) => event.stopPropagation()}
    >
      <header className="modal-head about-head">
        <div className="modal-title">
          <Info size={18} />
          <h2>Gemini Anything</h2>
        </div>
        <button type="button" className="ghost-button sm" onClick={onClose}>
          <X size={16} />
          Close
        </button>
      </header>

      <div className="about-body">
        <section className="about-hero">
          <div>
            <span className="about-kicker">Managed agent prototype stack</span>
            <h3>Three pieces, one developer loop.</h3>
            <p>
              The app gives you a fast inspection surface, the agent provides the hosted workbench, and the
              CLI adds media and Gemini utility capabilities without hard-coding them into either UI.
            </p>
            <div className="about-inline-map" aria-label="Solution architecture">
              {solutionParts.map((part, index) => (
                <span key={part.title}>
                  {part.title}
                  {index < solutionParts.length - 1 && <ArrowRight size={13} aria-hidden="true" />}
                </span>
              ))}
            </div>
          </div>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="about-repo-link"
            onClick={(event) => {
              event.preventDefault();
              void onOpenExternal(REPO_URL);
            }}
          >
            <ExternalLink size={14} />
            GitHub repo
          </a>
        </section>

        <section className="about-part-grid">
          {solutionParts.map((part) => {
            const Icon = part.icon;
            return (
              <article className="about-part" key={part.title}>
                <header>
                  <span className="about-part-icon">
                    <Icon size={15} />
                  </span>
                  <div>
                    <h4>{part.title}</h4>
                    <span>{part.eyebrow}</span>
                  </div>
                </header>
                <p>{part.summary}</p>
                <ul>
                  {part.features.map((feature) => (
                    <li key={feature}>
                      <CheckCircle2 size={13} />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </section>

        <section className="about-flow">
          <div>
            <span className="about-kicker">How they work together</span>
            <h3>Keep the app thin, keep the agent durable, keep capabilities discoverable.</h3>
          </div>
          <ol>
            {collaborationSteps.map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                <p>{step}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  </div>
);
