import { describe, expect, it } from "vitest";
import { normalizePreviewMarkdown } from "../src/renderer/lib/markdownPreview";

describe("markdown preview normalization", () => {
  it("renders transcript-style indented prose as prose instead of code blocks", () => {
    const source = [
      "KEVIN:",
      "",
      "    Number one. How many total episodes of the GCP Podcast were published in 2022?",
      "",
      "MAX:",
      "",
      "    OK, well, it's a weekly podcast, so that's a starting point."
    ].join("\n");

    expect(normalizePreviewMarkdown(source)).toBe(
      [
        "KEVIN:",
        "",
        "Number one. How many total episodes of the GCP Podcast were published in 2022?",
        "",
        "MAX:",
        "",
        "OK, well, it's a weekly podcast, so that's a starting point."
      ].join("\n")
    );
  });

  it("preserves fenced code indentation", () => {
    const source = ["```ts", "    const answer = 42;", "```"].join("\n");

    expect(normalizePreviewMarkdown(source)).toBe(source);
  });

  it("keeps indented command snippets as code blocks", () => {
    const source = ["Setup:", "", "    npm run dev"].join("\n");

    expect(normalizePreviewMarkdown(source)).toBe(source);
  });
});
