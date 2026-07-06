import { useEffect, useState } from "react";
import { recoverPendingTurn } from "../chat/controller";
import { resumeResearchIfNeeded } from "../gemini/deepResearch";
import { useStore } from "../state/store";
import { T } from "../tokens";
import { ChatView } from "./ChatView";
import { Composer } from "./Composer";
import { Icon, IconButton } from "./atoms";
import { SettingsPanel } from "./SettingsPanel";
import { Sidebar } from "./Sidebar";
import { WorkspacePanel } from "./WorkspacePanel";

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => (typeof window !== "undefined" ? window.innerWidth < 768 : false));
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return mobile;
}

export function AppShell() {
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  const activeSessionId = useStore((s) => s.activeSessionId);
  const sessions = useStore((s) => s.sessions);
  const sessionOrder = useStore((s) => s.sessionOrder);
  const setActiveSession = useStore((s) => s.setActiveSession);
  const createSession = useStore((s) => s.createSession);
  const hydrateSession = useStore((s) => s.hydrateSession);
  const agent = useStore((s) => s.agent);

  const active = activeSessionId ? sessions[activeSessionId] : null;

  useEffect(() => {
    // Never park the user on a dead end: land in a conversation immediately.
    if (sessionOrder.length === 0) createSession();
    else if (!activeSessionId) setActiveSession(sessionOrder[0]);
  }, [activeSessionId, sessionOrder, setActiveSession, createSession]);

  useEffect(() => {
    if (!activeSessionId) return;
    void hydrateSession(activeSessionId).then(() => {
      resumeResearchIfNeeded(activeSessionId);
      void recoverPendingTurn(activeSessionId);
    });
  }, [activeSessionId, hydrateSession]);

  const sidebar = (
    <Sidebar onOpenSettings={() => setSettingsOpen(true)} onNavigate={isMobile ? () => setDrawerOpen(false) : undefined} />
  );

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        background: T.bg,
        overflow: "hidden",
        // iOS standalone (home-screen) mode: the translucent status bar overlays the
        // page top — keep the whole shell below the notch/clock.
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      {!isMobile && sidebar}

      {isMobile && drawerOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 40 }}>
          <div
            onClick={() => setDrawerOpen(false)}
            style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)" }}
          />
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              bottom: 0,
              paddingTop: "env(safe-area-inset-top)",
              background: T.bgElev,
              animation: "aichat-in 0.18s ease",
            }}
          >
            {sidebar}
          </div>
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderBottom: `1px solid ${T.borderSoft}`,
            minHeight: 52,
          }}
        >
          {isMobile && <IconButton name="menu" label="Open menu" onClick={() => setDrawerOpen(true)} />}
          <span
            style={{
              flex: 1,
              fontSize: 14.5,
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {active?.title ?? "Gemini Anything"}
          </span>
          {active?.mode === "deep-research" && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12,
                color: T.accent,
                background: T.accentSoft,
                padding: "4px 9px",
                borderRadius: 20,
              }}
            >
              <Icon name="brain" size={13} />
              Deep Research
            </span>
          )}
          {active?.environmentId && (
            <IconButton
              name="folder"
              label="Container files"
              onClick={() => setWorkspaceOpen(true)}
            />
          )}
          {agent?.degraded && (
            <span
              title="Managed agent unavailable — chatting via the shared base agent"
              style={{
                fontSize: 12,
                color: T.warn,
                background: "rgba(255,198,107,0.12)",
                padding: "4px 9px",
                borderRadius: 20,
              }}
            >
              shared agent
            </span>
          )}
        </header>

        {active && (
          <>
            {/* Keyed per session: switching chats must never leak composer/scroll state. */}
            <ChatView key={`view-${active.id}`} sessionId={active.id} />
            <Composer key={`composer-${active.id}`} sessionId={active.id} />
          </>
        )}
      </div>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {workspaceOpen && active?.environmentId && (
        <WorkspacePanel envId={active.environmentId} onClose={() => setWorkspaceOpen(false)} />
      )}
    </div>
  );
}
