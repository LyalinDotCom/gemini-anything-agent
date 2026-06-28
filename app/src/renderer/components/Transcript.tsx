import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowDown,
  Brain,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Copy,
  Download,
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
import { BufferedAudio } from "./BufferedAudio";

type IconType = typeof Brain;
const LONG_BODY_PREVIEW_CHARS = 24000;
const MARKDOWN_RENDER_LIMIT_CHARS = 80000;

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

const BodyRenderer = ({
  body,
  markdown,
  terminal
}: {
  body: string;
  markdown?: boolean;
  terminal?: boolean;
}) => {
  const [expanded, setExpanded] = useState(body.length <= LONG_BODY_PREVIEW_CHARS);
  const isLong = body.length > LONG_BODY_PREVIEW_CHARS;
  const renderedBody = expanded ? body : body.slice(0, LONG_BODY_PREVIEW_CHARS);
  const renderMarkdown = Boolean(markdown && renderedBody.length <= MARKDOWN_RENDER_LIMIT_CHARS);
  const content = renderMarkdown ? (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {renderedBody}
      </ReactMarkdown>
    </div>
  ) : terminal ? (
    <pre className="term">{renderedBody}</pre>
  ) : (
    <div className="act-prose">{renderedBody}</div>
  );

  return (
    <div className={isLong ? "long-body" : undefined}>
      {content}
      {isLong && (
        <button type="button" className="long-body-toggle" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show less" : `Show full text (${body.length.toLocaleString()} chars)`}
        </button>
      )}
    </div>
  );
};

const renderBody = (body: string, markdown?: boolean, terminal?: boolean) => (
  <BodyRenderer body={body} markdown={markdown} terminal={terminal} />
);

const MEDIA_EXTENSIONS: Record<string, "image" | "video" | "audio"> = {
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".gif": "image",
  ".avif": "image",
  ".svg": "image",
  ".mp4": "video",
  ".webm": "video",
  ".mov": "video",
  ".m4v": "video",
  ".wav": "audio",
  ".mp3": "audio",
  ".m4a": "audio",
  ".aac": "audio",
  ".ogg": "audio",
  ".flac": "audio"
};

const mediaKindForUrl = (value: string | undefined): "image" | "video" | "audio" | undefined => {
  if (!value) {
    return undefined;
  }
  if (value.startsWith("data:image/")) {
    return "image";
  }
  if (value.startsWith("data:video/")) {
    return "video";
  }
  if (value.startsWith("data:audio/")) {
    return "audio";
  }
  const withoutQuery = value.split(/[?#]/)[0]?.toLowerCase() ?? "";
  const extension = Object.keys(MEDIA_EXTENSIONS).find((candidate) => withoutQuery.endsWith(candidate));
  return extension ? MEDIA_EXTENSIONS[extension] : undefined;
};

const isWebUrl = (value: string | undefined): boolean => /^https?:\/\//i.test(value ?? "");

const openExternal = (href: string | undefined): void => {
  if (!href || !isWebUrl(href)) {
    return;
  }
  if (window.managedAgents?.openExternal) {
    void window.managedAgents.openExternal(href);
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
};

const MediaEmbed = ({
  src,
  alt,
  kind
}: {
  src: string;
  alt?: string;
  kind: "image" | "video" | "audio";
}) => (
  <span className={`media-embed media-${kind}`}>
    {kind === "image" ? (
      <img src={src} alt={alt ?? ""} loading="lazy" />
    ) : kind === "video" ? (
      <video src={src} controls preload="metadata" />
    ) : (
      <BufferedAudio src={src} />
    )}
    {alt && <span className="media-caption">{alt}</span>}
  </span>
);

const markdownComponents: Components = {
  a: ({ href, children }) => {
    const kind = mediaKindForUrl(href);
    if (href && kind) {
      return (
        <span className="media-link">
          <MediaEmbed src={href} kind={kind} alt={typeof children === "string" ? children : undefined} />
          {isWebUrl(href) && (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault();
                openExternal(href);
              }}
            >
              Open in browser
            </a>
          )}
        </span>
      );
    }

    return (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          openExternal(href);
        }}
      >
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => {
    const kind = mediaKindForUrl(src);
    return src && kind ? <MediaEmbed src={src} kind={kind} alt={alt} /> : <img src={src} alt={alt ?? ""} />;
  }
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
  onCopy,
  onSaveText
}: {
  item: TimelineItem;
  onCopy: (text: string, label: string) => void;
  onSaveText?: (text: string, label: string) => void;
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
          {onSaveText && copyText.trim() && (
            <button
              type="button"
              className="act-save"
              title="Save text"
              onClick={() => onSaveText(copyText, item.title)}
            >
              <Download size={12} />
            </button>
          )}
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
  onCopy,
  onSaveText
}: {
  prompt: string;
  startedAt: number;
  items: TimelineItem[];
  streaming: boolean;
  embedded?: boolean;
  /** Shown when there is nothing to display yet (e.g. waiting on the stream). */
  empty?: string;
  onCopy: (text: string, label: string) => void;
  onSaveText?: (text: string, label: string) => void;
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

  // Direction B groups tool/thinking steps inside a single Sequoia inset card,
  // then renders the agent's answer as its own clean message bubble below it.
  const steps = items.filter((item) => item.kind !== "message");
  const messages = items.filter((item) => item.kind === "message");

  return (
    <div className={`transcript-wrap ${embedded ? "embedded" : ""}`}>
      <div className={`transcript ${embedded ? "embedded" : ""}`} ref={scrollRef} onScroll={onScroll}>
        <div className="turn turn-user">
          <span className="turn-avatar user" title={formatClock(startedAt)}>
            <User size={13} />
          </span>
          <div className="turn-main">
            <div className="turn-bubble">{prompt}</div>
          </div>
        </div>

        <div className="turn turn-agent">
          <span className="turn-avatar agent">
            <Sparkles size={13} />
          </span>
          <div className="turn-main">
            {items.length > 0 ? (
              <div className="act-list">
                {steps.length > 0 && (
                  <div className="act-group">
                    {steps.map((item) => (
                      <ActivityRow key={item.id} item={item} onCopy={onCopy} onSaveText={onSaveText} />
                    ))}
                  </div>
                )}
                {messages.map((item) => (
                  <div className="agent-answer" key={item.id}>
                    {renderBody(item.body ?? "", item.markdown, item.terminal)}
                    <button
                      type="button"
                      className="act-copy"
                      title="Copy"
                      onClick={() => onCopy(item.body ?? "", item.title)}
                    >
                      <Copy size={12} />
                    </button>
                    {onSaveText && item.body?.trim() && (
                      <button
                        type="button"
                        className="act-save"
                        title="Save text"
                        onClick={() => onSaveText(item.body ?? "", item.title)}
                      >
                        <Download size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
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

      {!embedded && showJump && (
        <button type="button" className="jump-latest" onClick={jump}>
          <ArrowDown size={13} /> Jump to latest
        </button>
      )}
    </div>
  );
};
