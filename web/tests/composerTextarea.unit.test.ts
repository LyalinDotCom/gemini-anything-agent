import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPOSER_MAX_VISIBLE_LINES, resizeComposerTextarea } from "../src/utils/composerTextarea";

const computedStyle = {
  lineHeight: "20px",
  fontSize: "14px",
  paddingTop: "4px",
  paddingBottom: "4px",
  borderTopWidth: "0px",
  borderBottomWidth: "0px",
};

const textarea = (scrollHeight: number, clientHeight = 108) => ({
  scrollHeight,
  value: "Some text",
  clientHeight,
  scrollTop: -1,
  style: { height: "", overflowY: "" },
}) as unknown as HTMLTextAreaElement;

describe("composer textarea sizing", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { getComputedStyle: () => computedStyle },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  });

  it("stays one line tall for a short message", () => {
    const element = textarea(24);
    resizeComposerTextarea(element, "end");
    expect(element.style.height).toBe("28px");
    expect(element.style.overflowY).toBe("hidden");
  });

  it("keeps an empty composer at its minimum instead of measuring wrapped placeholder text", () => {
    const element = textarea(220);
    element.value = "";
    resizeComposerTextarea(element, "start");
    expect(element.style.height).toBe("28px");
    expect(element.style.overflowY).toBe("hidden");
  });

  it("honors the shared control height for a one-line composer", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ ...computedStyle, minHeight: "38px" } as CSSStyleDeclaration);
    const element = textarea(24);
    resizeComposerTextarea(element, "end");
    expect(element.style.height).toBe("38px");
    vi.restoreAllMocks();
  });

  it("caps at five lines, scrolls pasted content to the start, and typing to the end", () => {
    expect(COMPOSER_MAX_VISIBLE_LINES).toBe(5);
    const pasted = textarea(220);
    resizeComposerTextarea(pasted, "start");
    expect(pasted.style.height).toBe("108px");
    expect(pasted.style.overflowY).toBe("auto");
    expect(pasted.scrollTop).toBe(0);

    const typed = textarea(220);
    resizeComposerTextarea(typed, "end");
    expect(typed.scrollTop).toBe(112);
  });
});
