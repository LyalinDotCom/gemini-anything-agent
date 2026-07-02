import { describe, expect, it } from "vitest";
import {
  decorateHtmlPreviewDocument,
  htmlPreviewMessageType,
  htmlPreviewOpenFileMessageType
} from "../src/renderer/lib/htmlPreview";

describe("html preview document decoration", () => {
  it("injects a base URL and external-link bridge into the head", () => {
    const decorated = decorateHtmlPreviewDocument(
      "<!doctype html><html><head><title>Demo</title></head><body><img src=\"hero.png\"></body></html>",
      "gemini-media://env/workspace/output/index.html"
    );

    expect(decorated).toContain('<base href="gemini-media://env/workspace/output/index.html">');
    expect(decorated).toContain(htmlPreviewMessageType);
    // Sibling output files route back to the host for inline preview swaps.
    expect(decorated).toContain(htmlPreviewOpenFileMessageType);
    expect(decorated.indexOf("<base")).toBeLessThan(decorated.indexOf("<title>Demo</title>"));
  });

  it("ignores head tags that only appear inside comments", () => {
    const decorated = decorateHtmlPreviewDocument(
      '<!-- template uses <head> --><html><head><title>Real</title></head><body></body></html>',
      "gemini-media://env/workspace/output/index.html"
    );

    const commentEnd = decorated.indexOf("-->");
    const baseIndex = decorated.indexOf("<base");
    expect(baseIndex).toBeGreaterThan(commentEnd);
    expect(decorated.indexOf("<title>Real</title>")).toBeGreaterThan(baseIndex);
  });

  it("ignores head tags inside script strings", () => {
    const decorated = decorateHtmlPreviewDocument(
      '<html><script>const t = "<head></head>";</script><head><title>Real</title></head><body></body></html>',
      "gemini-media://env/workspace/output/index.html"
    );

    const baseIndex = decorated.indexOf("<base");
    expect(baseIndex).toBeGreaterThan(decorated.indexOf("</script>"));
    expect(decorated).toContain('const t = "<head></head>";');
    expect(decorated.indexOf("<title>Real</title>")).toBeGreaterThan(baseIndex);
  });

  it("injects after the charset meta so encoding is detected first", () => {
    const decorated = decorateHtmlPreviewDocument(
      '<html><head><meta charset="utf-8"><title>Demo</title></head></html>',
      "gemini-media://env/workspace/output/index.html"
    );

    expect(decorated.indexOf("<base")).toBeGreaterThan(decorated.indexOf("charset"));
    expect(decorated.indexOf("<base")).toBeLessThan(decorated.indexOf("<title>Demo</title>"));
  });

  it("creates a complete document for html fragments", () => {
    const decorated = decorateHtmlPreviewDocument(
      "<main>Hello</main>",
      "gemini-media://env/workspace/output/index.html"
    );

    expect(decorated).toContain("<!doctype html>");
    expect(decorated).toContain("<body>");
    expect(decorated).toContain("<main>Hello</main>");
  });
});
