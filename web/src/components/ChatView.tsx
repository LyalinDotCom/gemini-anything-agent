import { useEffect, useRef } from "react";
import { useStore } from "../state/store";
import type { Message } from "../state/types";
import { T } from "../tokens";
import { Icon } from "./atoms";
import { MessageBubble } from "./MessageBubble";
import { SamplePromptGallery } from "./SamplePromptGallery";

const EMPTY: Message[] = [];

export function ChatView({
  sessionId,
  onOpenResourcePath,
}: {
  sessionId: string;
  onOpenResourcePath?: (path: string) => void;
}) {
  const messages = useStore((s) => s.messages[sessionId] ?? EMPTY);
  const queueRetry = useStore((s) => s.queueRetry);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div
      ref={scrollerRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain" }}
    >
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "10px 18px 24px" }}>
        {messages.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              marginTop: "18vh",
              animation: "aichat-in 0.3s ease",
            }}
          >
            <span style={{ padding: 13, borderRadius: 18, background: T.accentSoft, color: T.accent }}>
              <Icon name="sparkle" size={24} />
            </span>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>What are we doing today?</h2>
            <SamplePromptGallery sessionId={sessionId} />
          </div>
        ) : (
          messages.map((m, index) => <MessageBubble
            key={m.id}
            message={m}
            onOpenResourcePath={onOpenResourcePath}
            onRetry={m.role === "assistant" && (m.status === "error" || m.status === "stopped")
              ? () => queueRetry(sessionId, [...messages.slice(0, index)].reverse().find((candidate) => candidate.role === "user"))
              : undefined}
          />)
        )}
      </div>
    </div>
  );
}
