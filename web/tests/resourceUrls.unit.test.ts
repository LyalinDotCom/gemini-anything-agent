import { describe, expect, it } from "vitest";
import type { OutputFileRecord } from "../src/state/types";
import { buildResourceUrlMap, resolveResourceUrl, rewriteHtmlResourceUrls } from "../src/components/resourceUrls";

function output(label: string, mediaId: string, path = `/workspace/output/${label}`): OutputFileRecord {
  return {
    fingerprint: `${label}@1`,
    path,
    label,
    kind: label.endsWith(".html") ? "html" : "file",
    mediaId,
    mimeType: "application/octet-stream",
    size: 1,
    syncedAt: 1,
  };
}

describe("HTML resource URL rewriting", () => {
  const files = [
    output("app/index.html", "html"),
    output("app/hero.jpg", "hero"),
    output("audio/theme.mp3", "theme"),
  ];
  const assets = buildResourceUrlMap(files, new Map([
    ["html", "blob:html"],
    ["hero", "blob:hero"],
    ["theme", "blob:theme"],
  ]));

  it("resolves sibling, parent, encoded, and query-bearing references", () => {
    expect(resolveResourceUrl("./hero.jpg", "app/index.html", assets)).toBe("blob:hero");
    expect(resolveResourceUrl("../audio/theme.mp3?loop=1#start", "app/index.html", assets)).toBe("blob:theme?loop=1#start");
    expect(resolveResourceUrl("./hero%2Ejpg", "app/index.html", assets)).toBe("blob:hero");
  });

  it("drops URL suffixes from inlined data resources", () => {
    const dataAssets = new Map(assets);
    dataAssets.set("audio/theme.mp3", "data:audio/mpeg;base64,AAAA");
    expect(resolveResourceUrl("../audio/theme.mp3?loop=1#start", "app/index.html", dataAssets)).toBe("data:audio/mpeg;base64,AAAA");
  });

  it("leaves remote, data, anchor, and unknown references untouched", () => {
    expect(resolveResourceUrl("https://example.com/a.jpg", "app/index.html", assets)).toBeNull();
    expect(resolveResourceUrl("data:image/png;base64,abc", "app/index.html", assets)).toBeNull();
    expect(resolveResourceUrl("#section", "app/index.html", assets)).toBeNull();
    expect(resolveResourceUrl("missing.jpg", "app/index.html", assets)).toBeNull();
  });

  it("rewrites markup, srcset, CSS, and common scripted media loads", () => {
    const html = `
      <img src="hero.jpg" srcset="hero.jpg 1x, ./hero.jpg 2x">
      <audio poster='hero.jpg'><source src="../audio/theme.mp3"></audio>
      <style>.hero { background: url('./hero.jpg') }</style>
      <script>const audio = new Audio('../audio/theme.mp3'); fetch("hero.jpg");</script>
      <a href="#chapter">Chapter</a>
    `;
    const rewritten = rewriteHtmlResourceUrls(html, "app/index.html", assets);
    expect(rewritten).toContain('src="blob:hero"');
    expect(rewritten).toContain('srcset="blob:hero 1x, blob:hero 2x"');
    expect(rewritten).toContain("poster='blob:hero'");
    expect(rewritten).toContain('src="blob:theme"');
    expect(rewritten).toContain("url('blob:hero')");
    expect(rewritten).toContain("new Audio('blob:theme')");
    expect(rewritten).toContain('fetch("blob:hero")');
    expect(rewritten).toContain('href="#chapter"');
  });
});
