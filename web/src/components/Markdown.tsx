import { memo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { T } from "../tokens";
import { Icon } from "./atoms";

function Pre({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: "relative", margin: "10px 0" }}>
      <button
        type="button"
        aria-label="Copy code"
        onClick={() => {
          const text = ref.current?.innerText ?? "";
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          });
        }}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 8px",
          fontSize: 11.5,
          borderRadius: 6,
          border: `1px solid ${T.border}`,
          background: T.bgElev,
          color: copied ? T.ok : T.textDim,
          cursor: "pointer",
        }}
      >
        <Icon name="copy" size={12} />
        {copied ? "Copied" : "Copy"}
      </button>
      <pre
        ref={ref}
        style={{
          background: "#101014",
          border: `1px solid ${T.borderSoft}`,
          borderRadius: T.radiusSm,
          padding: "14px 14px 12px",
          overflowX: "auto",
          fontSize: 13,
          lineHeight: 1.55,
          fontFamily: T.mono,
        }}
      >
        {children}
      </pre>
    </div>
  );
}

const OUTPUT_PATH_RE = /\/workspace\/output\/[^\s<>"'`]+/g;
const TRAILING_PUNCTUATION_RE = /[.,;:!?)}\]]+$/;

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() || path;
}

function escapeMarkdownLabel(label: string): string {
  return label.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function linkifyOutputPaths(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/g)
    .map((chunk, index) => {
      if (index % 2 === 1) return chunk;
      return chunk.replace(OUTPUT_PATH_RE, (match) => {
        const trailing = match.match(TRAILING_PUNCTUATION_RE)?.[0] ?? "";
        const path = trailing ? match.slice(0, -trailing.length) : match;
        return `[${escapeMarkdownLabel(basename(path))}](resource:${encodeURIComponent(path)})${trailing}`;
      });
    })
    .join("");
}

export const Markdown = memo(function Markdown({
  text,
  onOpenResourcePath,
}: {
  text: string;
  onOpenResourcePath?: (path: string) => void;
}) {
  return (
    <div className="md" style={{ fontSize: 14.5, lineHeight: 1.65, wordBreak: "break-word" }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: Pre,
          a: ({ href, children }) => {
            const resourcePath = href?.startsWith("resource:") ? decodeURIComponent(href.slice("resource:".length)) : null;
            return resourcePath ? (
              <button
                type="button"
                onClick={() => onOpenResourcePath?.(resourcePath)}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  color: T.accent,
                  font: "inherit",
                  cursor: onOpenResourcePath ? "pointer" : "default",
                  textDecoration: "underline",
                  textDecorationThickness: "1px",
                  textUnderlineOffset: 3,
                }}
              >
                {children}
              </button>
            ) : (
              <a href={href} target="_blank" rel="noreferrer" style={{ color: T.accent }}>
                {children}
              </a>
            );
          },
          table: ({ children }) => (
            <div style={{ overflowX: "auto", margin: "10px 0" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 13.5 }}>{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th style={{ border: `1px solid ${T.border}`, padding: "6px 10px", background: T.bgElev, textAlign: "left" }}>
              {children}
            </th>
          ),
          td: ({ children }) => <td style={{ border: `1px solid ${T.border}`, padding: "6px 10px" }}>{children}</td>,
          code: ({ className, children }) => {
            const inline = !className;
            return inline ? (
              <code
                style={{
                  background: T.bgHover,
                  border: `1px solid ${T.borderSoft}`,
                  borderRadius: 5,
                  padding: "1.5px 5px",
                  fontSize: 13,
                  fontFamily: T.mono,
                }}
              >
                {children}
              </code>
            ) : (
              <code className={className} style={{ fontFamily: T.mono }}>
                {children}
              </code>
            );
          },
        }}
      >
        {linkifyOutputPaths(text)}
      </ReactMarkdown>
    </div>
  );
});
