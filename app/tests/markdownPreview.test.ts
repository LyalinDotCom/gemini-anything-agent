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

  it("preserves indented nested list items instead of joining them into prose", () => {
    const source = [
      "- Top level item.",
      "    - Nested item one about something.",
      "    - Nested item two about something else."
    ].join("\n");

    expect(normalizePreviewMarkdown(source)).toBe(source);
  });

  it("does not let fence markers inside indented code invert fence tracking", () => {
    const source = [
      "Example of writing a fence:",
      "",
      "      ```",
      "",
      "Now this prose paragraph continues after the example, with punctuation.",
      "",
      "    This indented paragraph reads like prose and should still be joined."
    ].join("\n");

    const normalized = normalizePreviewMarkdown(source);
    expect(normalized).toContain(
      "This indented paragraph reads like prose and should still be joined."
    );
    expect(normalized).not.toContain("    This indented paragraph");
  });
});
