import { useEffect, useRef } from "react";
import { useStore } from "../state/store";
import type { Message } from "../state/types";
import { T } from "../tokens";
import { Icon } from "./atoms";
import { MessageBubble } from "./MessageBubble";

const EMPTY: Message[] = [];

export function ChatView({ sessionId }: { sessionId: string }) {
  const messages = useStore((s) => s.messages[sessionId] ?? EMPTY);
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
            <p style={{ margin: 0, color: T.textDim, fontSize: 14, textAlign: "center", maxWidth: 420 }}>
              Ask questions, write and run code, research the web, or generate images — one remote agent figures out
              what you need.
            </p>
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
      </div>
    </div>
  );
}
