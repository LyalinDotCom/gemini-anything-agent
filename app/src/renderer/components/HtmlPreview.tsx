import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import type { EnvironmentOutputFile } from "../../shared/electron-api";
import {
  decorateHtmlPreviewDocument,
  htmlPreviewMessageType,
  htmlPreviewOpenFileMessageType
} from "../lib/htmlPreview";

export const HtmlPreview = ({
  file,
  onClose,
  onOpenExternal,
  onOpenLinkedFile
}: {
  file: EnvironmentOutputFile;
  onClose: () => void;
  onOpenExternal: (url: string) => void;
  /** Invoked when the previewed page links to a sibling output file. */
  onOpenLinkedFile?: (url: string) => void;
}) => {
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const lastOpenAtRef = useRef(0);
  const previewUrl = file.url ?? "";
  const previewDocument = useMemo(
    () => (source && previewUrl ? decorateHtmlPreviewDocument(source, previewUrl) : ""),
    [previewUrl, source]
  );

  useEffect(() => {
    const controller = new AbortController();
    setSource("");
    setLoadError(null);
    setLoading(true);

    const loadFile = async () => {
      if (window.managedAgents?.readEnvironmentOutputText) {
        const result = await window.managedAgents.readEnvironmentOutputText(file.path);
        if (controller.signal.aborted) {
          // The user switched files while this read was in flight; applying it
          // would render the old file against the new file's base URL.
          return;
        }
        if (!result.ok) {
          throw new Error(result.error.message);
        }
        setSource(result.value.content);
        return;
      }

      if (!previewUrl) {
        throw new Error("This HTML file is not available for preview.");
      }
      const response = await fetch(previewUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Could not load this HTML file (${response.status}).`);
      }
      setSource(await response.text());
    };

    void loadFile()
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setLoadError(error instanceof Error ? error.message : "Could not load this HTML preview.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [file.path, previewUrl]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Only the preview iframe may post link requests.
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) {
        return;
      }
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (!data || typeof data.url !== "string") {
        return;
      }
      if (data.type === htmlPreviewMessageType) {
        // External opens are rate limited — untrusted generated HTML could
        // otherwise spam the OS browser from a timer.
        const now = Date.now();
        if (now - lastOpenAtRef.current < 1000) {
          return;
        }
        lastOpenAtRef.current = now;
        onOpenExternal(data.url);
        return;
      }
      if (data.type === htmlPreviewOpenFileMessageType) {
        onOpenLinkedFile?.(data.url);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onOpenExternal, onOpenLinkedFile]);

  return (
    <div className="html-preview" aria-label={`Preview ${file.name}`}>
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
      <div className="html-preview-body">
        {loading ? (
          <div className="html-preview-state">
            <Loader2 size={16} className="spin" />
            <span>Loading preview...</span>
          </div>
        ) : loadError ? (
          <div className="html-preview-state error">
            <AlertCircle size={16} />
            <span>{loadError}</span>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            className="html-preview-frame"
            title={`Preview ${file.name}`}
            sandbox="allow-forms allow-scripts"
            allow="autoplay; fullscreen"
            srcDoc={previewDocument}
          />
        )}
      </div>
    </div>
  );
};
