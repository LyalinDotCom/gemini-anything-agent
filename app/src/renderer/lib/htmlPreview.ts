const previewMessageType = "gemini-anything:open-external-link";
const previewOpenFileMessageType = "gemini-anything:open-preview-file";

const escapeAttribute = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const linkGuardScript = (externalMessageType: string, openFileMessageType: string): string => `
<script>
(() => {
  const externalMessageType = ${JSON.stringify(externalMessageType)};
  const openFileMessageType = ${JSON.stringify(openFileMessageType)};
  const routeLink = (href) => {
    try {
      const url = new URL(String(href || ""), document.baseURI);
      if (url.protocol === "http:" || url.protocol === "https:") {
        // Web links open in the OS browser.
        parent.postMessage({ type: externalMessageType, url: url.toString() }, "*");
        return true;
      }
      if (url.protocol === "gemini-media:") {
        // Links to sibling output files stay inside the inline preview: the
        // host swaps the drawer preview to the target file (re-decorated),
        // so guards and the base URL survive "navigation".
        parent.postMessage({ type: openFileMessageType, url: url.toString() }, "*");
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  window.open = (href) => {
    routeLink(href);
    return null;
  };

  document.addEventListener("click", (event) => {
    const target = event.target;
    const anchor = target && target.closest ? target.closest("a[href]") : null;
    if (!anchor) {
      return;
    }
    const href = anchor.getAttribute("href");
    if (!href || href.trim().toLowerCase().startsWith("javascript:")) {
      event.preventDefault();
      return;
    }
    const trimmed = href.trim();
    if (trimmed.startsWith("#")) {
      // Same-document anchors scroll in place; the base href would otherwise
      // resolve them to an external URL.
      event.preventDefault();
      const fragment = trimmed.slice(1);
      const target = fragment
        ? document.getElementById(fragment) || document.getElementsByName(fragment)[0]
        : null;
      if (target && target.scrollIntoView) {
        target.scrollIntoView();
      } else if (!fragment) {
        window.scrollTo(0, 0);
      }
      return;
    }
    // Never let the iframe navigate away from the decorated document: a raw
    // navigation would load the target without the base URL or this guard.
    // http(s) opens externally, sibling output files swap the inline preview
    // via the host, and everything else is inert.
    event.preventDefault();
    routeLink(href);
  }, true);
})();
</script>
`;

export const htmlPreviewMessageType = previewMessageType;
export const htmlPreviewOpenFileMessageType = previewOpenFileMessageType;

// Blanks comments and script bodies with same-length whitespace so tag
// searches cannot match a "<head>" that only appears inside a comment or a
// script string. Indices in the blanked copy remain valid in the original.
const blankNonMarkup = (source: string): string =>
  source
    .replace(/<!--[\s\S]*?-->/g, (match) => " ".repeat(match.length))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (match) => " ".repeat(match.length));

export const decorateHtmlPreviewDocument = (source: string, baseUrl: string): string => {
  const runtime = [
    `<base href="${escapeAttribute(baseUrl)}">`,
    linkGuardScript(previewMessageType, previewOpenFileMessageType)
  ].join("\n");

  const searchable = blankNonMarkup(source);
  const headWithOptionalCharsetPattern =
    /<head(?:\s[^>]*)?>\s*(?:<meta\s+charset=["']?[^"'>\s]+["']?\s*\/?>\s*)?/i;
  const headMatch = headWithOptionalCharsetPattern.exec(searchable);
  if (headMatch) {
    const insertAt = headMatch.index + headMatch[0].length;
    return `${source.slice(0, insertAt)}\n${runtime}\n${source.slice(insertAt)}`;
  }

  const htmlMatch = /<html(?:\s[^>]*)?>/i.exec(searchable);
  if (htmlMatch) {
    const insertAt = htmlMatch.index + htmlMatch[0].length;
    return `${source.slice(0, insertAt)}\n<head>\n${runtime}\n</head>\n${source.slice(insertAt)}`;
  }

  return `<!doctype html>
<html>
<head>
${runtime}
</head>
<body>
${source}
</body>
</html>`;
};
