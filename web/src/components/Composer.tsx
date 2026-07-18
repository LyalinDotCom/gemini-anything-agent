import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cancelServerTurn, sendTurn, type TurnInput } from "../chat/controller";
import { sendResearchTurn } from "../gemini/deepResearch";
import { useStore } from "../state/store";
import { mediaId as makeMediaId, putMedia, base64ToBlob, getMediaBase64, getMediaUrl } from "../storage/messages";
import { T } from "../tokens";
import { uid } from "../utils/id";
import { blobToDataUrl, dataUrlMime, dataUrlToBase64, fileToCompressedDataUrl } from "../utils/media";
import { VoiceRecorder } from "../utils/recorder";
import { Icon, IconButton, Spinner } from "./atoms";
import { AgentPicker } from "./AgentPicker";
import { RunOptionsPanel } from "./RunOptionsPanel";
import { profileForSession } from "../agentProfiles";
import { effectiveRunOptions, runOptionCount } from "../state/runOptions";
import { resizeComposerTextarea, type ComposerScrollAlignment } from "../utils/composerTextarea";

interface Draft {
  id: string;
  dataUrl: string;
  base64: string;
  mimeType: string;
}

interface AudioDraft {
  base64: string;
  mimeType: string;
}

type MicState = "idle" | "recording";

export function Composer({ sessionId }: { sessionId: string }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [audioDraft, setAudioDraft] = useState<AudioDraft | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [micState, setMicState] = useState<MicState>("idle");
  const [micError, setMicError] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const retryMessage = useStore((s) => s.retryMessages[sessionId]);
  const queueRetry = useStore((s) => s.queueRetry);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const lastInputEventRef = useRef<{ sessionId: string; value: string; alignment: ComposerScrollAlignment } | null>(null);
  const pasteTextPendingRef = useRef(false);
  const inputResizeTimerRef = useRef<number | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const text = useStore((s) => s.draftText[sessionId] ?? "");
  const setDraftText = useStore((s) => s.setDraftText);
  const setText = (v: string) => setDraftText(sessionId, v);
  const busyHere = useStore((s) => !!s.streaming[sessionId]);
  const sendOnEnter = useStore((s) => s.settings.sendOnEnter);
  const session = useStore((s) => s.sessions[sessionId]);
  const isEmptySession = useStore((s) => (s.messages[sessionId]?.length ?? 0) === 0);
  const research = profileForSession(session ?? {}).research;
  const options = effectiveRunOptions(session ?? {});
  const optionCount = runOptionCount(options);

  // Voice goes INTO the agent chain as an audio part — the container hears it;
  // nothing is transcribed on the client.
  const toggleMic = async () => {
    setMicError(null);
    if (micState === "recording") {
      try {
        const blob = await recorderRef.current?.stop();
        recorderRef.current = null;
        if (blob && blob.size > 200) {
          const dataUrl = await blobToDataUrl(blob);
          setAudioDraft({ base64: dataUrlToBase64(dataUrl), mimeType: blob.type || "audio/webm" });
        }
      } catch {
        setMicError("Recording failed — try again.");
      } finally {
        setMicState("idle");
      }
      return;
    }
    try {
      const rec = new VoiceRecorder();
      await rec.start();
      recorderRef.current = rec;
      setMicState("recording");
    } catch {
      setMicError("Microphone unavailable or permission denied.");
      setMicState("idle");
    }
  };

  useLayoutEffect(() => {
    const lastInput = lastInputEventRef.current;
    const alignment = lastInput?.sessionId === sessionId ? lastInput.alignment : "start";
    const textarea = areaRef.current;
    if (textarea) resizeComposerTextarea(textarea, alignment);
    if (!textarea) return;
    const frame = window.requestAnimationFrame(() => {
      textarea.scrollTop = alignment === "start" ? 0 : textarea.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sessionId, text]);

  useEffect(() => {
    if (!retryMessage) return;
    let alive = true;
    void (async () => {
      const nextDrafts: Draft[] = [];
      let nextAudio: AudioDraft | null = null;
      let nextText = "";
      for (const part of retryMessage.parts) {
        if (part.kind === "text") nextText += `${nextText ? "\n" : ""}${part.text}`;
        if (part.kind === "image") {
          const stored = await getMediaBase64(part.mediaId);
          const dataUrl = await getMediaUrl(part.mediaId);
          if (stored && dataUrl) nextDrafts.push({ id: uid(), dataUrl, base64: stored.base64, mimeType: stored.mimeType });
        }
        if (part.kind === "audio") {
          const stored = await getMediaBase64(part.mediaId);
          if (stored) nextAudio = { base64: stored.base64, mimeType: stored.mimeType };
        }
      }
      if (!alive) return;
      setText(nextText);
      setDrafts(nextDrafts);
      setAudioDraft(nextAudio);
      queueRetry(sessionId, undefined);
      requestAnimationFrame(() => {
        if (areaRef.current) resizeComposerTextarea(areaRef.current, "start");
        areaRef.current?.focus();
      });
    })();
    return () => { alive = false; };
    // retryMessage is an explicit one-shot signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryMessage]);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setCompressing(true);
    try {
      const next: Draft[] = [];
      for (const file of [...files].slice(0, 4 - drafts.length)) {
        if (!file.type.startsWith("image/")) continue;
        const dataUrl = await fileToCompressedDataUrl(file);
        next.push({ id: uid(), dataUrl, base64: dataUrlToBase64(dataUrl), mimeType: dataUrlMime(dataUrl) });
      }
      setDrafts((d) => [...d, ...next]);
    } finally {
      setCompressing(false);
    }
  };

  const send = async () => {
    const value = text.trim();
    if ((!value && drafts.length === 0 && !audioDraft) || busyHere) return;

    if (research) {
      if (!value) return;
      setText("");
      void sendResearchTurn(sessionId, value);
      return;
    }

    const attachments: NonNullable<TurnInput["attachments"]> = [];
    for (const draft of drafts) {
      const mid = makeMediaId(sessionId, `up-${draft.id}`);
      await putMedia(mid, sessionId, base64ToBlob(draft.base64, draft.mimeType), draft.mimeType);
      attachments.push({ kind: "image", mediaId: mid, mimeType: draft.mimeType, base64: draft.base64 });
    }
    if (audioDraft) {
      const mid = makeMediaId(sessionId, `voice-${uid()}`);
      await putMedia(mid, sessionId, base64ToBlob(audioDraft.base64, audioDraft.mimeType), audioDraft.mimeType);
      attachments.push({ kind: "audio", mediaId: mid, mimeType: audioDraft.mimeType, base64: audioDraft.base64 });
    }
    setText("");
    setDrafts([]);
    setAudioDraft(null);
    void sendTurn(sessionId, { text: value, attachments });
  };

  return (
    <div style={{ padding: "0 16px calc(14px + env(safe-area-inset-bottom))" }}>
      <div style={{ maxWidth: 780, margin: "0 auto" }}>
        {audioDraft && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
              padding: "6px 12px",
              borderRadius: 20,
              background: T.accentSoft,
              color: T.accent,
              fontSize: 12.5,
            }}
          >
            <Icon name="mic" size={14} />
            voice message attached
            <button
              type="button"
              aria-label="Remove voice message"
              onClick={() => setAudioDraft(null)}
              style={{ background: "transparent", border: "none", color: T.accent, cursor: "pointer", display: "flex" }}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        )}
        {drafts.length > 0 && (
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            {drafts.map((d) => (
              <div key={d.id} style={{ position: "relative" }}>
                <img
                  src={d.dataUrl}
                  alt="attachment"
                  style={{
                    width: 64,
                    height: 64,
                    objectFit: "cover",
                    borderRadius: T.radiusSm,
                    border: `1px solid ${T.border}`,
                  }}
                />
                <button
                  type="button"
                  aria-label="Remove attachment"
                  onClick={() => setDrafts((list) => list.filter((x) => x.id !== d.id))}
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    border: "none",
                    background: T.bgHover,
                    color: T.text,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name="x" size={11} />
                </button>
              </div>
            ))}
            {compressing && <Spinner size={16} />}
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 6,
            border: `1px solid ${T.border}`,
            background: T.bgInput,
            borderRadius: T.radius,
            padding: "10px 10px 10px 8px",
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {!research && (
            <IconButton
              name="image"
              label="Attach image"
              onClick={() => fileRef.current?.click()}
              disabled={busyHere || drafts.length >= 4}
            />
          )}
          {!research && (
            <button
              type="button"
              title={micState === "recording" ? "Stop recording" : "Record a voice message"}
              onClick={() => void toggleMic()}
              disabled={busyHere}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: T.radiusSm,
                border: "none",
                background: micState === "recording" ? T.dangerSoft : "transparent",
                color: micState === "recording" ? T.danger : T.textDim,
                cursor: "pointer",
                animation: micState === "recording" ? "aichat-pulse 1.2s ease infinite" : undefined,
              }}
            >
              <Icon name="mic" size={17} />
            </button>
          )}
          <textarea
            ref={areaRef}
            rows={1}
            value={text}
            placeholder={busyHere ? "Working…" : "Message… (code, research, images — just ask)"}
            onChange={(e) => {
              const alignment: ComposerScrollAlignment = pasteTextPendingRef.current ? "start" : "end";
              lastInputEventRef.current = {
                sessionId,
                value: e.target.value,
                alignment,
              };
              pasteTextPendingRef.current = false;
              setText(e.target.value);
              if (areaRef.current) resizeComposerTextarea(areaRef.current, alignment);
              if (inputResizeTimerRef.current !== undefined) window.clearTimeout(inputResizeTimerRef.current);
              inputResizeTimerRef.current = window.setTimeout(() => {
                if (areaRef.current) resizeComposerTextarea(areaRef.current, alignment);
                inputResizeTimerRef.current = undefined;
              }, 32);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && sendOnEnter) {
                e.preventDefault();
                void send();
              }
            }}
            onPaste={(e) => {
              pasteTextPendingRef.current = Boolean(e.clipboardData?.getData("text/plain"));
              const items = [...(e.clipboardData?.items ?? [])].filter((i) => i.type.startsWith("image/"));
              if (items.length) {
                const dt = new DataTransfer();
                for (const it of items) {
                  const f = it.getAsFile();
                  if (f) dt.items.add(f);
                }
                void addFiles(dt.files);
              }
            }}
            style={{
              flex: 1,
              resize: "none",
              border: "none",
              outline: "none",
              background: "transparent",
              color: T.text,
              fontSize: 14.5,
              lineHeight: 1.5,
              boxSizing: "border-box",
              overflowY: "hidden",
              padding: "4px 0",
            }}
          />
          {busyHere ? (
            <button
              type="button"
              onClick={() => void cancelServerTurn(sessionId)}
              title="Cancel server turn"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 38,
                height: 38,
                borderRadius: T.radiusSm,
                border: `1px solid ${T.border}`,
                background: T.bgElev,
                color: T.danger,
                cursor: "pointer",
              }}
            >
              <Icon name="stop" size={16} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={(!text.trim() && drafts.length === 0 && !audioDraft) || busyHere}
              title="Send"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 38,
                height: 38,
                borderRadius: T.radiusSm,
                border: "none",
                background: (text.trim() || drafts.length || audioDraft) && !busyHere ? T.accent : T.bgHover,
                color: (text.trim() || drafts.length || audioDraft) && !busyHere ? "#0B0B0D" : T.textFaint,
                cursor: (text.trim() || drafts.length || audioDraft) && !busyHere ? "pointer" : "default",
              }}
            >
              <Icon name="send" size={16} />
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 7 }}>
          <AgentPicker sessionId={sessionId} disabled={busyHere} />
          <button
            type="button"
            disabled={busyHere}
            onClick={() => setShowOptions((value) => !value)}
            style={{ height: 32, display: "inline-flex", alignItems: "center", gap: 6, padding: "0 9px", borderRadius: T.radiusSm, border: `1px solid ${optionCount ? "rgba(124,156,255,0.38)" : T.borderSoft}`, background: optionCount ? T.accentSoft : "transparent", color: optionCount ? T.accent : T.textDim, cursor: busyHere ? "default" : "pointer", fontSize: 12.5, fontWeight: 700 }}
          >
            <Icon name="gear" size={14} /> Options{optionCount ? ` · ${optionCount}` : ""}
          </button>
        </div>
        {showOptions && <RunOptionsPanel sessionId={sessionId} />}
        {(micError || isEmptySession) && (
          <p style={{ margin: "8px 0 0", color: micError ? T.danger : T.textFaint, fontSize: 11.5, textAlign: "center" }}>
            {micError ??
              (research
                ? "Deep Research mode: long-running background investigation with sources — survives reloads."
                : "Everything runs in a remote container session — code, search, images — and its files sync down to you.")}
          </p>
        )}
      </div>
    </div>
  );
}
