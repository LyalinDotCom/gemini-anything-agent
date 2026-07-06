// First-launch key onboarding (Spark KeyGate pattern): paste key → live validation
// ping → stored in this browser only. The key never touches our servers because
// there are none.
import { useState } from "react";
import { validateKey } from "../gemini/client";
import { setStoredKey } from "../gemini/keyStore";
import { T } from "../tokens";
import { Icon, PrimaryButton } from "./atoms";

type Phase = "enter" | "checking" | "success";

export function KeyGate() {
  const [value, setValue] = useState("");
  const [phase, setPhase] = useState<Phase>("enter");
  const [error, setError] = useState<string | null>(null);

  const devKey =
    import.meta.env.DEV && import.meta.env.VITE_GEMINI_API_KEY ? String(import.meta.env.VITE_GEMINI_API_KEY) : null;

  const submit = async (key: string) => {
    const trimmed = key.trim();
    if (!trimmed) return;
    setPhase("checking");
    setError(null);
    const res = await validateKey(trimmed);
    if (!res.ok) {
      setPhase("enter");
      setError(res.message);
      return;
    }
    setPhase("success");
    window.setTimeout(() => setStoredKey(trimmed), 450);
  };

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "calc(24px + env(safe-area-inset-top)) 24px calc(24px + env(safe-area-inset-bottom))",
        background: `radial-gradient(1000px 500px at 50% -10%, ${T.accentSoft}, transparent), ${T.bg}`,
      }}
    >
      <div style={{ width: "100%", maxWidth: 460, animation: "aichat-in 0.35s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <span
            style={{
              display: "inline-flex",
              padding: 9,
              borderRadius: 12,
              background: T.accentSoft,
              color: T.accent,
            }}
          >
            <Icon name="sparkle" size={20} />
          </span>
          <span style={{ fontWeight: 700, fontSize: 17 }}>Gemini Anything</span>
        </div>

        <h1 style={{ fontSize: 26, lineHeight: 1.25, margin: "0 0 10px", fontWeight: 700 }}>
          Bring your own Gemini key.
        </h1>
        <p style={{ color: T.textDim, fontSize: 14.5, lineHeight: 1.55, margin: "0 0 22px" }}>
          This app runs entirely in your browser and talks straight to Gemini with{" "}
          <strong style={{ color: T.text }}>your</strong> API key. The key is stored only on this device and sent only
          to Google.
        </p>

        <div
          style={{
            display: "flex",
            gap: 10,
            padding: 8,
            borderRadius: T.radius,
            background: T.bgElev,
            border: `1px solid ${phase === "success" ? T.ok : error ? T.danger : T.border}`,
          }}
        >
          <input
            type="password"
            autoFocus
            placeholder="Paste your Gemini API key"
            value={value}
            disabled={phase !== "enter"}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit(value);
            }}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: T.text,
              fontSize: 14.5,
              padding: "8px 10px",
              fontFamily: T.mono,
            }}
          />
          <PrimaryButton onClick={() => void submit(value)} disabled={!value.trim()} busy={phase === "checking"}>
            {phase === "success" ? "Ready" : "Start"}
          </PrimaryButton>
        </div>

        {error ? (
          <p style={{ color: T.danger, fontSize: 13.5, margin: "12px 2px 0" }}>{error}</p>
        ) : (
          <p style={{ color: T.textFaint, fontSize: 13, margin: "12px 2px 0" }}>
            The key is checked against the agents API before we save it.
          </p>
        )}

        <div style={{ marginTop: 22, display: "flex", gap: 16, alignItems: "center" }}>
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
            style={{ color: T.accent, fontSize: 13.5, textDecoration: "none" }}
          >
            Get a free key at AI Studio →
          </a>
          {devKey ? (
            <button
              type="button"
              onClick={() => void submit(devKey)}
              style={{
                background: "transparent",
                border: `1px solid ${T.border}`,
                color: T.textDim,
                borderRadius: T.radiusSm,
                padding: "5px 10px",
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              Use dev key
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
