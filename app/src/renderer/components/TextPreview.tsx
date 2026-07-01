import { useEffect, useState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { EnvironmentOutputFile } from "../../shared/electron-api";
import { normalizePreviewMarkdown } from "../lib/markdownPreview";

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

const markdownComponents = (
  baseUrl: string,
  onOpenExternal: (url: string) => void
): Components => ({
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(event) => {
        const url = webUrl(href, baseUrl);
        if (!url) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        onOpenExternal(url);
      }}
    >
      {children}
    </a>
  )
});

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
  onOpenExternal
}: {
  file: EnvironmentOutputFile;
  onClose: () => void;
  onOpenExternal: (url: string) => void;
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
        ) : markdown ? (
          <div className="md markdown-preview-document">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents(previewUrl, onOpenExternal)}
            >
              {normalizePreviewMarkdown(body)}
            </ReactMarkdown>
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
