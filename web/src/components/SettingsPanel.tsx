import { useState } from "react";
import { deleteAgent, ensureChatAgent, recreateChatAgent } from "../gemini/agents";
import { validateKey } from "../gemini/client";
import { toFriendly } from "../gemini/errors";
import { clearStoredKey, setStoredKey } from "../gemini/keyStore";
import { CHAT_AGENT_ID, MODELS } from "../models";
import { useStore } from "../state/store";
import { idbWipe } from "../storage/db";
import { T } from "../tokens";
import { IconButton, PrimaryButton, Spinner } from "./atoms";

const sectionTitle: React.CSSProperties = {
  fontSize: 12.5,
  color: T.textFaint,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  margin: "0 0 10px",
};

const card: React.CSSProperties = {
  border: `1px solid ${T.borderSoft}`,
  borderRadius: T.radiusSm,
  padding: 14,
  marginBottom: 18,
  background: T.bgInput,
};

function GhostButton({
  children,
  onClick,
  danger,
  busy,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        borderRadius: T.radiusSm,
        border: `1px solid ${danger ? "rgba(255,107,107,0.4)" : T.border}`,
        background: "transparent",
        color: danger ? T.danger : T.textDim,
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      {busy && <Spinner size={11} />}
      {children}
    </button>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const agent = useStore((s) => s.agent);
  const setAgent = useStore((s) => s.setAgent);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  const [newKey, setNewKey] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentMsg, setAgentMsg] = useState<string | null>(null);

  const replaceKey = async () => {
    if (!newKey.trim()) return;
    setKeyBusy(true);
    setKeyMsg(null);
    const res = await validateKey(newKey);
    if (!res.ok) {
      setKeyMsg(res.message);
      setKeyBusy(false);
      return;
    }
    setStoredKey(newKey.trim());
    setAgent(null); // different key → different agent space
    setNewKey("");
    setKeyMsg("Key replaced.");
    setKeyBusy(false);
  };

  const runAgentAction = async (fn: () => Promise<unknown>, doneMsg: string) => {
    setAgentBusy(true);
    setAgentMsg(null);
    try {
      await fn();
      setAgentMsg(doneMsg);
    } catch (e) {
      setAgentMsg(toFriendly(e).message);
    } finally {
      setAgentBusy(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
      <div
        style={{
          position: "relative",
          width: "min(560px, calc(100vw - 28px))",
          maxHeight: "84vh",
          overflowY: "auto",
          background: T.bgElev,
          border: `1px solid ${T.border}`,
          borderRadius: T.radius,
          padding: 20,
          animation: "aichat-in 0.2s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 17, flex: 1 }}>Settings</h2>
          <IconButton name="x" label="Close" onClick={onClose} />
        </div>

        <h3 style={sectionTitle}>API key</h3>
        <div style={card}>
          <p style={{ margin: "0 0 10px", fontSize: 13, color: T.textDim }}>
            Stored only in this browser. Replace it any time — sessions and the managed agent belong to the key.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="password"
              placeholder="New Gemini API key"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              style={{
                flex: 1,
                background: T.bg,
                border: `1px solid ${T.border}`,
                borderRadius: T.radiusSm,
                color: T.text,
                fontSize: 13,
                padding: "8px 10px",
                fontFamily: T.mono,
                outline: "none",
              }}
            />
            <PrimaryButton onClick={() => void replaceKey()} disabled={!newKey.trim()} busy={keyBusy}>
              Replace
            </PrimaryButton>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
            <GhostButton
              danger
              onClick={() => {
                if (window.confirm("Remove the stored key from this browser? You'll see the key screen again.")) {
                  clearStoredKey();
                  onClose();
                }
              }}
            >
              Clear key & sign out
            </GhostButton>
            {keyMsg && <span style={{ fontSize: 12.5, color: keyMsg === "Key replaced." ? T.ok : T.danger }}>{keyMsg}</span>}
          </div>
        </div>

        <h3 style={sectionTitle}>Managed agent</h3>
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontFamily: T.mono, fontSize: 13.5 }}>{CHAT_AGENT_ID}</span>
            <span
              style={{
                fontSize: 11.5,
                padding: "2px 8px",
                borderRadius: 12,
                background: agent?.degraded ? "rgba(255,198,107,0.12)" : "rgba(110,231,160,0.12)",
                color: agent?.degraded ? T.warn : T.ok,
              }}
            >
              {agent ? (agent.degraded ? "degraded (shared base agent)" : "healthy") : "not created yet"}
            </span>
          </div>
          <p style={{ margin: "0 0 10px", fontSize: 12.5, color: T.textFaint }}>
            Base: {MODELS.chatAgentBase} · payload {agent?.payloadFingerprint ?? "—"} · verified{" "}
            {agent ? new Date(agent.verifiedAt).toLocaleString() : "never"}. Chat sessions run entirely in this agent's
            server-side container; a copy of your key is installed there so the agent can call the Gemini API itself.
            App updates and key rotations recreate the agent automatically on your next message.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <GhostButton
              busy={agentBusy}
              onClick={() =>
                void runAgentAction(async () => setAgent(await ensureChatAgent(agent, true)), "Agent verified.")
              }
            >
              Verify now
            </GhostButton>
            <GhostButton
              busy={agentBusy}
              onClick={() =>
                void runAgentAction(async () => setAgent(await recreateChatAgent(agent)), "Agent recreated fresh.")
              }
            >
              Recreate
            </GhostButton>
            <GhostButton
              danger
              busy={agentBusy}
              onClick={() =>
                void runAgentAction(async () => {
                  await deleteAgent(CHAT_AGENT_ID);
                  setAgent(null);
                }, "Agent deleted — it will be recreated on your next message.")
              }
            >
              Delete
            </GhostButton>
          </div>
          {agentMsg && <p style={{ margin: "10px 0 0", fontSize: 12.5, color: T.textDim }}>{agentMsg}</p>}

          <p style={{ margin: "12px 0 0", fontSize: 12, color: T.textFaint }}>
            This sample manages exactly one agent, by name. Other agents on your key (from other projects) are never
            listed or touched.
          </p>
        </div>

        <h3 style={sectionTitle}>Preferences</h3>
        <div style={card}>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={settings.sendOnEnter}
              onChange={(e) => updateSettings({ sendOnEnter: e.target.checked })}
            />
            Send on Enter (Shift+Enter for a new line)
          </label>
        </div>

        <h3 style={sectionTitle}>Danger zone</h3>
        <div style={{ ...card, marginBottom: 4 }}>
          <GhostButton
            danger
            onClick={() => {
              if (window.confirm("Wipe ALL local data — every conversation, image, and setting on this device?")) {
                void idbWipe().then(() => {
                  try {
                    localStorage.removeItem("aichat-store");
                  } catch {
                    // ignore
                  }
                  location.reload();
                });
              }
            }}
          >
            Wipe all local data
          </GhostButton>
        </div>
      </div>
    </div>
  );
}
