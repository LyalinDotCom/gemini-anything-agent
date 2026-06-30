import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import type { EnvironmentOutputFile } from "../../shared/electron-api";

type WebviewElement = HTMLElement & {
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
};

const stripHash = (value: string): string => {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.replace(/#.*/, "");
  }
};

const linkCaptureScript = `
(() => {
  if (window.__geminiAnythingHtmlPreviewLinkGuard) {
    return;
  }
  window.__geminiAnythingHtmlPreviewLinkGuard = true;
  document.addEventListener("click", (event) => {
    const target = event.target;
    const anchor = target && target.closest ? target.closest("a[href]") : null;
    if (!anchor) {
      return;
    }
    const href = anchor.href;
    if (!href || href.startsWith("javascript:")) {
      return;
    }
    event.preventDefault();
    window.location.href = href;
  }, true);
})();
`;

export const HtmlPreview = ({
  file,
  onClose,
  onOpenExternal
}: {
  file: EnvironmentOutputFile;
  onClose: () => void;
  onOpenExternal: (url: string) => void;
}) => {
  const webviewRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const previewUrl = file.url ?? "";
  const previewDocumentUrl = useMemo(() => stripHash(previewUrl), [previewUrl]);

  const resizeGuest = () => {
    const webview = webviewRef.current as WebviewElement | null;
    const body = bodyRef.current;
    if (!webview || !body) {
      return;
    }
    const rect = body.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    webview.style.width = `${width}px`;
    webview.style.height = `${height}px`;
    void webview.executeJavaScript?.(
      "window.dispatchEvent(new Event('resize'));",
      false
    ).catch(() => undefined);
  };

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }

    const resize = () => resizeGuest();
    const observer = new ResizeObserver(resize);
    observer.observe(body);
    requestAnimationFrame(resize);
    const timers = [window.setTimeout(resize, 60), window.setTimeout(resize, 250), window.setTimeout(resize, 700)];

    return () => {
      observer.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [previewUrl]);

  useEffect(() => {
    const webview = webviewRef.current as WebviewElement | null;
    if (!webview || !previewUrl) {
      return;
    }

    const maybeOpenExternally = (event: Event) => {
      const url = (event as Event & { url?: string }).url;
      if (!url || stripHash(url) === previewDocumentUrl || url === "about:blank") {
        return;
      }
      event.preventDefault();
      onOpenExternal(url);
    };

    const injectLinkGuard = () => {
      void webview.executeJavaScript?.(linkCaptureScript, false).catch(() => undefined);
    };

    const handleLoaded = () => {
      setLoadError(null);
      resizeGuest();
      window.setTimeout(resizeGuest, 80);
    };

    const handleLoadFailure = (event: Event) => {
      const details = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        isMainFrame?: boolean;
        validatedURL?: string;
      };
      if (details.errorCode === -3 || details.isMainFrame === false) {
        return;
      }
      setLoadError(details.errorDescription || "Could not load this HTML preview.");
    };

    webview.addEventListener("will-navigate", maybeOpenExternally);
    webview.addEventListener("new-window", maybeOpenExternally);
    webview.addEventListener("dom-ready", injectLinkGuard);
    webview.addEventListener("did-finish-load", handleLoaded);
    webview.addEventListener("did-fail-load", handleLoadFailure);

    return () => {
      webview.removeEventListener("will-navigate", maybeOpenExternally);
      webview.removeEventListener("new-window", maybeOpenExternally);
      webview.removeEventListener("dom-ready", injectLinkGuard);
      webview.removeEventListener("did-finish-load", handleLoaded);
      webview.removeEventListener("did-fail-load", handleLoadFailure);
    };
  }, [onOpenExternal, previewDocumentUrl, previewUrl]);

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
      <div className="html-preview-body" ref={bodyRef}>
        <webview
          ref={webviewRef}
          className="html-preview-webview"
          src={previewUrl}
        />
      </div>
      {loadError && (
        <div className="html-preview-error">
          <AlertCircle size={18} />
          <span>{loadError}</span>
        </div>
      )}
    </div>
  );
};
