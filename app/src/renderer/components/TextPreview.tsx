import { Component, useEffect, useState, type ReactNode } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EnvironmentOutputFile } from "../../shared/electron-api";

// Past this size, markdown parsing would block the renderer for seconds; the
// file is shown as plain text instead.
const MAX_MARKDOWN_RENDER_BYTES = 2 * 1024 * 1024;

const webUrl = (href: string | undefined, base: string): string | undefined => {
  if (!href) {
    return undefined;
  }
  try {
    const url = new URL(href, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const assetUrl = (src: string | undefined, base: string): string | undefined => {
  if (!src) {
    return undefined;
  }
  try {
    const url = new URL(src, base);
    return ["http:", "https:", "data:", "gemini-media:"].includes(url.protocol)
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

const markdownComponents = (
  baseUrl: string,
  onOpenExternal: (url: string) => void,
  onOpenLinkedFile?: (url: string) => void
): Components => ({
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        const raw = (href ?? "").trim();
        if (raw.startsWith("#")) {
          const fragment = raw.slice(1);
          const target = fragment ? document.getElementById(fragment) : null;
          target?.scrollIntoView();
          return;
        }
        const url = webUrl(href, baseUrl);
        if (url) {
          onOpenExternal(url);
          return;
        }
        // Relative links to sibling output files swap the inline preview.
        const inline = assetUrl(raw, baseUrl);
        if (inline?.startsWith("gemini-media:")) {
          onOpenLinkedFile?.(inline);
        }
      }}
    >
      {children}
    </a>
  ),
  // Relative image paths in agent-generated markdown resolve against the
  // file's own media URL, not the app origin.
  img: ({ src, alt, title }) => {
    const resolved = assetUrl(typeof src === "string" ? src : undefined, baseUrl);
    if (!resolved) {
      return <span className="markdown-preview-missing-image">{alt || "image"}</span>;
    }
    return <img src={resolved} alt={alt ?? ""} title={title ?? undefined} loading="lazy" />;
  }
});

/** A crashed markdown render must not unmount the whole app tree. */
class MarkdownErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const textViewerLanguage = (file: EnvironmentOutputFile): string => {
  const extension = file.name.toLowerCase().split(".").pop();
  switch (extension) {
    case "json":
    case "jsonl":
      return "json";
    case "csv":
      return "csv";
    case "tsv":
      return "tsv";
    case "srt":
      return "srt";
    case "vtt":
      return "vtt";
    case "log":
      return "log";
    default:
      return "text";
  }
};

export const TextPreview = ({
  file,
  onClose,
  onOpenExternal,
  onOpenLinkedFile
}: {
  file: EnvironmentOutputFile;
  onClose: () => void;
  onOpenExternal: (url: string) => void;
  /** Invoked when the previewed markdown links to a sibling output file. */
  onOpenLinkedFile?: (url: string) => void;
}) => {
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const previewUrl = file.url ?? "";
  const markdown = file.fileType === "markdown";

  useEffect(() => {
    const controller = new AbortController();
    setBody("");
    setError(null);
    setLoading(true);

    const loadFile = async () => {
      if (window.managedAgents?.readEnvironmentOutputText) {
        const result = await window.managedAgents.readEnvironmentOutputText(file.path);
        if (controller.signal.aborted) {
          // The user switched files while this read was in flight.
          return;
        }
        if (!result.ok) {
          throw new Error(result.error.message);
        }
        setBody(result.value.content);
        return;
      }

      if (!previewUrl) {
        throw new Error("This file is not available for preview.");
      }
      const response = await fetch(previewUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Could not load this file (${response.status}).`);
      }
      setBody(await response.text());
    };

    void loadFile()
      .catch((fetchError: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(fetchError instanceof Error ? fetchError.message : "Could not load this file.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [file.path, previewUrl]);

  return (
    <div className="html-preview markdown-preview" aria-label={`Preview ${file.name}`}>
      <header className="html-preview-head">
        <div className="html-preview-title">
          <strong>{file.name}</strong>
          <span title={file.sandboxPath}>{file.relativePath}</span>
        </div>
        <button
          type="button"
          className="head-icon"
          title="Close preview"
          aria-label="Close preview"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </header>
      <div className="html-preview-body markdown-preview-body">
        {loading ? (
          <div className="markdown-preview-state">
            <Loader2 size={16} className="spin" />
            <span>Loading file...</span>
          </div>
        ) : error ? (
          <div className="markdown-preview-state error">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        ) : markdown && body.length <= MAX_MARKDOWN_RENDER_BYTES ? (
          <div className="md markdown-preview-document">
            <MarkdownErrorBoundary
              key={file.path}
              fallback={<pre className="text-preview-document"><code>{body}</code></pre>}
            >
              {/* Files render verbatim: indentation and tabs are semantic in
                  markdown, so no transcript-style normalization here. */}
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents(previewUrl, onOpenExternal, onOpenLinkedFile)}
              >
                {body}
              </ReactMarkdown>
            </MarkdownErrorBoundary>
          </div>
        ) : (
          <pre className="text-preview-document">
            <code className={`language-${textViewerLanguage(file)}`}>{body}</code>
          </pre>
        )}
      </div>
    </div>
  );
};
