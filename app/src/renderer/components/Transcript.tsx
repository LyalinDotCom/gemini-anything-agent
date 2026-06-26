import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowDown,
  Brain,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Copy,
  FilePen,
  Link2,
  Loader2,
  Search,
  Sparkles,
  Terminal,
  User,
  Wrench,
  XCircle
} from "lucide-react";
import type { ActivityKind, TimelineItem } from "../lib/timeline";

type IconType = typeof Brain;

const KIND_ICON: Record<ActivityKind, IconType> = {
  thinking: Brain,
  command: Terminal,
  write_file: FilePen,
  function: Wrench,
  search: Search,
  url: Link2,
  message: Sparkles,
  lifecycle: CircleDot,
  error: XCircle,
  other: CircleDot
};

const formatClock = (value: number | undefined): string =>
  value
    ? new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";

const StatusGlyph = ({ status }: { status: TimelineItem["status"] }) => {
  if (status === "running") {
    return <Loader2 size={13} className="spin" />;
  }
  if (status === "error") {
    return <XCircle size={13} />;
  }
  return <CheckCircle2 size={13} />;
};

const renderBody = (body: string, markdown?: boolean, terminal?: boolean) => {
  if (markdown) {
    return (
      <div className="md">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
      </div>
    );
  }
  if (terminal) {
    return <pre className="term">{body}</pre>;
  }
  return <div className="act-prose">{body}</div>;
};

const itemCopyText = (item: TimelineItem): string => {
  if (!item.details?.length) {
    return item.body ?? "";
  }
  return item.details
    .map((detail, index) => {
      const text = detail.body?.trim() || detail.summary?.trim() || "";
      return text ? `${index + 1}. ${detail.title}\n${text}` : `${index + 1}. ${detail.title}`;
    })
    .join("\n\n");
};

const detailHasContent = (detail: NonNullable<TimelineItem["details"]>[number]): boolean =>
  Boolean(detail.body?.trim().length || detail.summary?.trim().length);

const ActivityRow = ({
  item,
  onCopy
}: {
  item: TimelineItem;
  onCopy: (text: string, label: string) => void;
}) => {
  // The answer is the payload of the turn — show it open. Steps stay folded.
  const startsOpen =
    item.kind === "message" ||
    (item.kind !== "thinking" && (item.count ?? 0) > 1 && item.status === "running");
  const [open, setOpen] = useState(startsOpen);
  const Icon = KIND_ICON[item.kind];
  const hasBody = Boolean(
    (item.body && item.body.trim().length) ||
      item.details?.some(detailHasContent)
  );
  const liveEmptyThinking = item.kind === "thinking" && item.status === "running" && !hasBody;
  const copyText = itemCopyText(item);

  useEffect(() => {
    setOpen(startsOpen);
  }, [item.kind, item.id, startsOpen]);

  return (
    <div
      className={`act act-${item.kind} ${item.status === "error" ? "is-error" : ""} ${
        liveEmptyThinking ? "is-live-thinking" : ""
      }`}
    >
      <button
        type="button"
        className="act-head"
        onClick={() => hasBody && setOpen((value) => !value)}
        aria-expanded={open}
        disabled={!hasBody}
      >
        <span className="act-chevron">
          {hasBody && <ChevronRight size={13} className={open ? "rot" : ""} />}
        </span>
        <span className="act-icon">
          <Icon size={14} />
        </span>
        <span className="act-title">{item.title}</span>
        {liveEmptyThinking && (
          <span className="thinking-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        )}
        {item.count && item.count > 1 && <span className="act-count">{item.count}</span>}
        {item.summary && item.kind !== "message" && <span className="act-summary">{item.summary}</span>}
        <span className={`act-status st-${item.status}`}>
          <StatusGlyph status={item.status} />
        </span>
      </button>

      {open && hasBody && (
        <div className="act-body">
          <button
            type="button"
            className="act-copy"
            title="Copy"
            onClick={() => onCopy(copyText, item.title)}
          >
            <Copy size={12} />
          </button>
          {item.details?.length ? (
            <div className="act-details">
              {item.details.map((detail, index) => (
                <div className="act-detail" key={detail.id}>
                  <div className="act-detail-head">
                    <span>{index + 1}</span>
                    <strong>{detail.title}</strong>
                    {detail.summary && <code>{detail.summary}</code>}
                    <span className={`act-status st-${detail.status}`}>
                      <StatusGlyph status={detail.status} />
                    </span>
                  </div>
                  {detail.body?.trim() ? renderBody(detail.body, detail.markdown, detail.terminal) : null}
                </div>
              ))}
            </div>
          ) : (
            renderBody(item.body ?? "", item.markdown, item.terminal)
          )}
        </div>
      )}
    </div>
  );
};

export const Transcript = ({
  prompt,
  startedAt,
  items,
  streaming,
  embedded = false,
  empty,
  onCopy
}: {
  prompt: string;
  startedAt: number;
  items: TimelineItem[];
  streaming: boolean;
  embedded?: boolean;
  /** Shown when there is nothing to display yet (e.g. waiting on the stream). */
  empty?: string;
  onCopy: (text: string, label: string) => void;
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow the tail only while the run is still streaming; a finished run opens
  // at the top so it reads prompt → activity → answer in order.
  const stickRef = useRef(streaming);
  const [showJump, setShowJump] = useState(false);

  const onScroll = () => {
    if (embedded) {
      return;
    }
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    stickRef.current = distance < 80;
    setShowJump(distance > 160);
  };

  // Follow the tail as content streams in, but only while pinned to the bottom.
  useLayoutEffect(() => {
    if (embedded) {
      return;
    }
    const node = scrollRef.current;
    if (node && stickRef.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [embedded, items, streaming]);

  const jump = () => {
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
      stickRef.current = true;
      setShowJump(false);
    }
  };

  return (
    <div className={`transcript-wrap ${embedded ? "embedded" : ""}`}>
      <div className={`transcript ${embedded ? "embedded" : ""}`} ref={scrollRef} onScroll={onScroll}>
        <div className="turn turn-user">
          <span className="turn-avatar user">
            <User size={13} />
          </span>
          <div className="turn-main">
            <div className="turn-meta">
              <strong>You</strong>
              <span>{formatClock(startedAt)}</span>
            </div>
            <div className="turn-prompt">{prompt}</div>
          </div>
        </div>

        <div className="turn turn-agent">
          <span className="turn-avatar agent">
            <Sparkles size={13} />
          </span>
          <div className="turn-main">
            <div className="turn-meta">
              <strong>Agent</strong>
              {streaming && <span className="live-dot">working…</span>}
            </div>
            <div className="act-list">
              {items.length > 0 ? (
                items.map((item) => <ActivityRow key={item.id} item={item} onCopy={onCopy} />)
              ) : (
                <div className="act-waiting">
                  {streaming ? (
                    <>
                      <Loader2 size={13} className="spin" /> {empty ?? "Waiting for the first event…"}
                    </>
                  ) : (
                    (empty ?? "No activity recorded for this run.")
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {!embedded && showJump && (
        <button type="button" className="jump-latest" onClick={jump}>
          <ArrowDown size={13} /> Jump to latest
        </button>
      )}
    </div>
  );
};
