import { useEffect, useRef, useState } from "react";
import { cancelServerTurn, recoverPendingTurn } from "../chat/controller";
import { resumeResearchIfNeeded } from "../gemini/deepResearch";
import { outputFileMatchesPath, syncOutputMedia } from "../gemini/envFiles";
import { useStore } from "../state/store";
import type { OutputFileRecord } from "../state/types";
import { getMediaUrl } from "../storage/messages";
import { T } from "../tokens";
import { ChatView } from "./ChatView";
import { Composer } from "./Composer";
import { Icon, IconButton } from "./atoms";
import { AudioDock, ResourceLightbox } from "./ResourcePreview";
import { ChatDiagnosticsPanel } from "./ChatDiagnosticsPanel";
import { SettingsPanel } from "./SettingsPanel";
import { Sidebar } from "./Sidebar";
import { WorkspacePanel } from "./WorkspacePanel";
import { profileForSession } from "../agentProfiles";
import { AboutPanel } from "./AboutPanel";

type PanelTab = "files" | "diagnostics";

function PanelTabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        minWidth: 0,
        height: 32,
        border: "none",
        borderRadius: T.radiusSm,
        background: active ? T.accentSoft : "transparent",
        color: active ? T.accent : T.textDim,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        fontSize: 12.5,
        fontWeight: 800,
        cursor: "pointer",
      }}
    >
      <Icon name={icon} size={14} />
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </button>
  );
}

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  );
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
  const [aboutOpen, setAboutOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab | null>(null);
  const [cancelingServer, setCancelingServer] = useState(false);
  const outputSignatures = useRef<Record<string, string>>({});
  const resourcePanelClosed = useRef<Set<string>>(new Set());
  const [newResourcesBySession, setNewResourcesBySession] = useState<
    Record<string, string[]>
  >({});
  const [previewFile, setPreviewFile] = useState<OutputFileRecord | null>(null);
  const [audioFile, setAudioFile] = useState<OutputFileRecord | null>(null);

  const activeSessionId = useStore((s) => s.activeSessionId);
  const sessions = useStore((s) => s.sessions);
  const sessionOrder = useStore((s) => s.sessionOrder);
  const setActiveSession = useStore((s) => s.setActiveSession);
  const createSession = useStore((s) => s.createSession);
  const hydrateSession = useStore((s) => s.hydrateSession);
  const agent = useStore((s) => s.agent);
  const activeStreaming = useStore((s) =>
    Boolean(activeSessionId && s.streaming[activeSessionId]),
  );

  const active = activeSessionId ? sessions[activeSessionId] : null;
  const activeProfile = active ? profileForSession(active) : null;
  const activeFiles = active?.envFiles ?? [];
  const resourceCount = activeFiles.length;
  const outputSignature = activeFiles
    .map((file) => file.fingerprint)
    .join("\n");
  const activeNewFingerprints = new Set(
    activeSessionId ? (newResourcesBySession[activeSessionId] ?? []) : [],
  );
  const workspaceOpen = panelTab === "files";
  const diagnosticsOpen = panelTab === "diagnostics";

  const pauseAllMedia = () => {
    document.querySelectorAll("audio, video").forEach((node) => {
      if (node instanceof HTMLMediaElement) node.pause();
    });
  };

  const downloadFile = async (file: OutputFileRecord) => {
    const url = await getMediaUrl(file.mediaId);
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = file.label.split("/").filter(Boolean).pop() || "resource";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const openOutputFile = (file: OutputFileRecord) => {
    pauseAllMedia();
    if (file.kind === "image" || file.kind === "video" || file.kind === "html" || file.kind === "text") {
      setAudioFile(null);
      setPreviewFile(file);
    } else if (file.kind === "audio") {
      setPreviewFile(null);
      setAudioFile(file);
    } else {
      setPreviewFile(null);
      setAudioFile(null);
      void downloadFile(file);
    }
  };

  const openResourcePath = async (path: string) => {
    if (!activeSessionId) return;
    let file = (
      useStore.getState().sessions[activeSessionId]?.envFiles ?? []
    ).find((candidate) => outputFileMatchesPath(candidate, path));
    const envId = useStore.getState().sessions[activeSessionId]?.environmentId;
    if (!file && envId) {
      try {
        await syncOutputMedia(activeSessionId, envId);
        file = (
          useStore.getState().sessions[activeSessionId]?.envFiles ?? []
        ).find((candidate) => outputFileMatchesPath(candidate, path));
      } catch {
        // The files panel remains the fallback if the server snapshot cannot be refreshed.
      }
    }
    if (file) {
      openOutputFile(file);
    } else {
      resourcePanelClosed.current.delete(activeSessionId);
      setPanelTab("files");
    }
  };

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

  useEffect(() => {
    if (!activeSessionId) return;
    const previous = outputSignatures.current[activeSessionId];
    if (previous === undefined) {
      outputSignatures.current[activeSessionId] = outputSignature;
      if (
        resourceCount > 0 &&
        !resourcePanelClosed.current.has(activeSessionId)
      ) {
        setPanelTab("files");
      }
      return;
    }
    if (outputSignature && outputSignature !== previous) {
      const previousSet = new Set(previous.split("\n").filter(Boolean));
      const added = activeFiles
        .filter((file) => !previousSet.has(file.fingerprint))
        .map((file) => file.fingerprint);
      if (added.length > 0) {
        setNewResourcesBySession((current) => ({
          ...current,
          [activeSessionId]: [
            ...new Set([...(current[activeSessionId] ?? []), ...added]),
          ],
        }));
      }
      resourcePanelClosed.current.delete(activeSessionId);
      setPanelTab("files");
    }
    outputSignatures.current[activeSessionId] = outputSignature;
  }, [activeSessionId, outputSignature, resourceCount, activeFiles]);

  useEffect(() => {
    pauseAllMedia();
    setPreviewFile(null);
    setAudioFile(null);
    setPanelTab(null);
    setCancelingServer(false);
    if (!activeSessionId) {
      return;
    }
    if (
      resourceCount > 0 &&
      !resourcePanelClosed.current.has(activeSessionId)
    ) {
      setPanelTab("files");
    }
  }, [activeSessionId, resourceCount]);

  useEffect(() => {
    if (
      !activeSessionId ||
      !active?.environmentId ||
      activeFiles.length > 0 ||
      !active.envSeen?.length
    )
      return;
    void syncOutputMedia(activeSessionId, active.environmentId).catch(
      () => undefined,
    );
  }, [
    activeSessionId,
    active?.environmentId,
    active?.envSeen?.length,
    activeFiles.length,
  ]);

  const closePanel = () => {
    if (panelTab === "files" && activeSessionId) {
      resourcePanelClosed.current.add(activeSessionId);
      setNewResourcesBySession((current) => ({
        ...current,
        [activeSessionId]: [],
      }));
    }
    setPanelTab(null);
  };

  const selectFilesTab = () => {
    if (activeSessionId) {
      resourcePanelClosed.current.delete(activeSessionId);
      setNewResourcesBySession((current) => ({
        ...current,
        [activeSessionId]: [],
      }));
    }
    setPanelTab("files");
  };

  const selectDiagnosticsTab = () => {
    setPanelTab("diagnostics");
  };

  const cancelActiveServerTurn = async () => {
    if (!activeSessionId || cancelingServer) return;
    setCancelingServer(true);
    try {
      await cancelServerTurn(activeSessionId);
    } finally {
      setCancelingServer(false);
    }
  };

  const sidebar = (
    <Sidebar
      onOpenSettings={() => setSettingsOpen(true)}
      onOpenAbout={() => setAboutOpen(true)}
      onNavigate={isMobile ? () => setDrawerOpen(false) : undefined}
    />
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
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.55)",
            }}
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

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
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
          {isMobile && (
            <IconButton
              name="menu"
              label="Open menu"
              onClick={() => setDrawerOpen(true)}
            />
          )}
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
          {activeProfile && (
            <span
              title={`${activeProfile.description} ${activeProfile.model}.`}
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
              <Icon name={activeProfile.icon} size={13} />
              {activeProfile.label}
            </span>
          )}
          {active && (
            <span style={{ position: "relative", display: "inline-flex" }}>
              <IconButton
                name="folder"
                label={
                  resourceCount > 0
                    ? `Container files (${resourceCount})`
                    : "Container files"
                }
                size={21}
                onClick={selectFilesTab}
                style={{
                  width: 38,
                  height: 36,
                  border: `1px solid ${resourceCount > 0 || active.environmentId ? "rgba(124,156,255,0.42)" : T.borderSoft}`,
                  background:
                    resourceCount > 0 || active.environmentId
                      ? T.accentSoft
                      : "transparent",
                  color:
                    resourceCount > 0 || active.environmentId
                      ? T.accent
                      : T.textDim,
                  boxShadow:
                    resourceCount > 0
                      ? "0 0 0 1px rgba(124,156,255,0.08)"
                      : undefined,
                }}
              />
              {resourceCount > 0 && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    right: -4,
                    top: -4,
                    minWidth: 17,
                    height: 17,
                    padding: "0 4px",
                    borderRadius: 99,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: T.warn,
                    color: "#0B0B0D",
                    fontSize: 10.5,
                    fontWeight: 800,
                    border: `1px solid ${T.bg}`,
                  }}
                >
                  {resourceCount > 9 ? "9+" : resourceCount}
                </span>
              )}
            </span>
          )}
          {active && (
            <IconButton
              name="code"
              label="Chat diagnostics"
              onClick={selectDiagnosticsTab}
              style={{
                border: `1px solid ${diagnosticsOpen ? "rgba(124,156,255,0.42)" : T.borderSoft}`,
                background: diagnosticsOpen ? T.accentSoft : "transparent",
                color: diagnosticsOpen ? T.accent : T.textDim,
              }}
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
            <ChatView
              key={`view-${active.id}`}
              sessionId={active.id}
              onOpenResourcePath={(path) => void openResourcePath(path)}
            />
            <AudioDock file={audioFile} onClose={() => setAudioFile(null)} />
            <Composer key={`composer-${active.id}`} sessionId={active.id} />
          </>
        )}
      </div>

      {panelTab && activeSessionId && active && (
        <aside
          style={{
            width: "min(390px, 100vw)",
            flex: "0 0 min(390px, 100vw)",
            borderLeft: `1px solid ${T.border}`,
            background: T.bgElev,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
          aria-label="Chat side panel"
        >
          <header
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px",
              borderBottom: `1px solid ${T.borderSoft}`,
            }}
          >
            <div
              role="tablist"
              aria-label="Chat panel tabs"
              style={{
                flex: 1,
                minWidth: 0,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 4,
                padding: 3,
                borderRadius: T.radiusSm,
                border: `1px solid ${T.borderSoft}`,
                background: T.bg,
              }}
            >
              <PanelTabButton
                active={workspaceOpen}
                icon="folder"
                label={`Files${resourceCount > 0 ? ` (${resourceCount})` : ""}`}
                onClick={selectFilesTab}
              />
              <PanelTabButton
                active={diagnosticsOpen}
                icon="code"
                label="Diagnostics"
                onClick={selectDiagnosticsTab}
              />
            </div>
            <IconButton name="x" label="Close panel" onClick={closePanel} />
          </header>

          {workspaceOpen ? (
            <WorkspacePanel
              sessionId={activeSessionId}
              envId={active.environmentId}
              files={activeFiles}
              newFingerprints={activeNewFingerprints}
              onOpenFile={openOutputFile}
            />
          ) : (
            <ChatDiagnosticsPanel
              session={active}
              streaming={activeStreaming}
              canceling={cancelingServer}
              onCancelServerTurn={() => void cancelActiveServerTurn()}
            />
          )}
        </aside>
      )}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {aboutOpen && <AboutPanel onClose={() => setAboutOpen(false)} />}
      <ResourceLightbox
        file={previewFile}
        files={activeFiles}
        onClose={() => setPreviewFile(null)}
      />
    </div>
  );
}
