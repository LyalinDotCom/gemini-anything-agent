import { useEffect, useRef, useState } from "react";
import { AGENT_PROFILES, profileForSession, type AgentMode } from "../agentProfiles";
import { useStore } from "../state/store";
import { T } from "../tokens";
import { Icon } from "./atoms";

export function AgentPicker({ sessionId, disabled }: { sessionId: string; disabled: boolean }) {
  const session = useStore((s) => s.sessions[sessionId]);
  const patchSession = useStore((s) => s.patchSession);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected = profileForSession(session ?? {});
  const mode = selected.mode;
  const locked = (session?.messageCount ?? 0) > 0;

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={root} style={{ position: "relative" }}>
      <button
        type="button"
        aria-label={`Agent: ${selected.label}`}
        aria-expanded={open}
        title={locked ? "Start a new chat to choose a different agent." : selected.description}
        disabled={disabled || locked}
        onClick={() => setOpen((value) => !value)}
        style={{
          height: 32,
          padding: "0 9px",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          borderRadius: T.radiusSm,
          border: `1px solid ${mode === "antigravity" ? T.borderSoft : "rgba(124,156,255,0.4)"}`,
          background: mode === "antigravity" ? "transparent" : T.accentSoft,
          color: mode === "antigravity" ? T.textDim : T.accent,
          cursor: disabled || locked ? "default" : "pointer",
          opacity: disabled ? 0.55 : 1,
          fontSize: 12.5,
          fontWeight: 700,
        }}
      >
        <Icon name={selected.icon} size={14} />
        {selected.label}
        {!locked && <Icon name="chevron" size={12} />}
      </button>
      {open && !locked && (
        <div
          role="menu"
          aria-label="Choose an agent"
          style={{
            position: "absolute",
            left: 0,
            bottom: "calc(100% + 8px)",
            zIndex: 35,
            width: "min(360px, calc(100vw - 32px))",
            padding: 7,
            border: `1px solid ${T.border}`,
            borderRadius: T.radius,
            background: T.bgElev,
            boxShadow: "0 18px 48px rgba(0,0,0,0.48)",
          }}
        >
          {(Object.keys(AGENT_PROFILES) as AgentMode[]).map((candidate) => {
            const profile = AGENT_PROFILES[candidate];
            const active = candidate === mode;
            return (
              <button
                key={candidate}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  patchSession(sessionId, {
                    agentMode: candidate,
                    mode: profile.research ? "deep-research" : "chat",
                  });
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  display: "grid",
                  gridTemplateColumns: "34px 1fr",
                  gap: 9,
                  textAlign: "left",
                  padding: "10px 11px",
                  border: `1px solid ${active ? "rgba(124,156,255,0.38)" : "transparent"}`,
                  borderRadius: T.radiusSm,
                  background: active ? T.accentSoft : "transparent",
                  color: T.text,
                  cursor: "pointer",
                }}
              >
                <span style={{ width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center", background: active ? "rgba(124,156,255,0.2)" : T.bgHover, color: active ? T.accent : T.textDim }}>
                  <Icon name={profile.icon} size={16} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", fontSize: 13.5 }}>{profile.label}</strong>
                  <span style={{ display: "block", marginTop: 2, color: T.textDim, fontSize: 12.25, lineHeight: 1.35 }}>{profile.description}</span>
                  <small style={{ display: "block", marginTop: 4, color: T.textFaint, fontSize: 11.25 }}>{profile.model}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
