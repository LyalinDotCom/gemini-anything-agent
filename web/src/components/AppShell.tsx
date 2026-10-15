import { isModelFile } from "../utils/modelFiles";
import { useEffect, useRef, useState } from "react";
import { cancelServerTurn } from "../chat/controller";
import { listenForAppReturn, refreshActiveSession, resumeStoredSession } from "../chat/sessionRefresh";
import { wakeStoredRun } from "../gemini/storedRunWake";
import { cancelResearchTurn } from "../gemini/deepResearch";
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
    typeof window !== "undefined" ? window.innerWidth < 1024 : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener("change", onChange);
    onChange(); // The viewport can change between initial render and subscribing.
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return mobile;
}

export function AppShell() {
  useEffect(() => listenForAppReturn(refreshActiveSession, window, document), []);
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
    if (isModelFile(file) || file.kind === "image" || file.kind === "video" || file.kind === "html" || file.kind === "text") {
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
    const current = useStore.getState();
    if (current.sessionOrder.length === 0) current.createSession();
    else if (!current.activeSessionId || !current.sessions[current.activeSessionId]) current.setActiveSession(current.sessionOrder[0]);
  }, [activeSessionId, sessionOrder, setActiveSession, createSession]);

  useEffect(() => {
    if (!activeSessionId) return;
    void hydrateSession(activeSessionId).then(() => {
      wakeStoredRun(activeSessionId);
      void resumeStoredSession(activeSessionId).catch(() => undefined);
    }).catch(() => useStore.getState().patchSession(activeSessionId, { cancelNotice: "Could not read saved chat history. Reload and try again; no new turn has replaced it." }));
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
        if (!isMobile) setPanelTab("files");
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
      if (!isMobile) setPanelTab("files");
    }
    outputSignatures.current[activeSessionId] = outputSignature;
  }, [activeSessionId, outputSignature, resourceCount, activeFiles, isMobile]);

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
      !isMobile && resourceCount > 0 &&
      !resourcePanelClosed.current.has(activeSessionId)
    ) {
      setPanelTab("files");
    }
  }, [activeSessionId]);

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
      if (activeProfile?.research) await cancelResearchTurn(activeSessionId); else await cancelServerTurn(activeSessionId);
    } finally {
      setCancelingServer(false);
    }
  };

  useEffect(() => {
    if (!drawerOpen) return;
    const returnFocus = document.querySelector<HTMLElement>('[aria-label="Open menu"]');
    document.querySelector<HTMLElement>('[aria-label="Close chat history"]')?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setDrawerOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); requestAnimationFrame(() => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
      (dialog?.querySelector<HTMLElement>("button, input") ?? returnFocus)?.focus();
    }); };
  }, [drawerOpen]);

  useEffect(() => { if (!isMobile) setDrawerOpen(false); }, [isMobile]);

  useEffect(() => {
    if (!isMobile || !panelTab) return;
    document.querySelector<HTMLElement>('[aria-label="Close panel"]')?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closePanel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isMobile, panelTab, activeSessionId]);

  const sidebar = (
    <Sidebar
      onOpenSettings={() => { setDrawerOpen(false); setSettingsOpen(true); }}
      onOpenAbout={() => { setDrawerOpen(false); setAboutOpen(true); }}
      onNavigate={isMobile ? () => { setDrawerOpen(false); setPanelTab(null); } : undefined}
      onClose={isMobile ? () => setDrawerOpen(false) : undefined}
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
        <div role="dialog" aria-modal="true" aria-label="Chat history" style={{ position: "fixed", inset: 0, zIndex: 40 }}>
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
        inert={isMobile && (drawerOpen || Boolean(panelTab))}
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
              style={{width:44,height:40}}
              onClick={() => setDrawerOpen(true)}
            />
          )}
          {isMobile && <IconButton name="plus" label="Start new chat" style={{width:44,height:40}} onClick={() => { createSession(); setDrawerOpen(false); setPanelTab(null); }} />}
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
            {active?.title ?? "Gemini Anywhere Agent"}
          </span>
          {activeProfile && !isMobile && (
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
            <Composer key={`composer-${active.id}`} sessionId={active.id} onPreviewModel={openOutputFile} />
          </>
        )}
      </div>

      {panelTab && activeSessionId && active && (
        <aside
          style={{
            position: isMobile ? "fixed" : undefined,
            inset: isMobile ? 0 : undefined,
            zIndex: isMobile ? 45 : undefined,
            width: isMobile ? "100%" : "min(390px, 100vw)",
            flex: isMobile ? undefined : "0 0 min(390px, 100vw)",
            borderLeft: `1px solid ${T.border}`,
            background: T.bgElev,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
          role={isMobile ? "dialog" : undefined}
          aria-modal={isMobile ? true : undefined}
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
