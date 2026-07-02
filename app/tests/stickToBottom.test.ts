import { describe, expect, it } from "vitest";
import { createStickToBottom } from "../src/renderer/lib/stickToBottom";

// Minimal scrollable element stand-in: setting scrollTop clamps like a real
// container, and the test drives scroll events explicitly.
const fakeScroller = (contentHeight: number, viewportHeight: number, scrollTop = 0) => {
  const node = {
    scrollHeight: contentHeight,
    clientHeight: viewportHeight,
    scrollTop
  };
  return node as unknown as HTMLElement & { scrollTop: number; scrollHeight: number };
};

describe("stick-to-bottom scroll policy", () => {
  it("follows new content while the user has never scrolled", () => {
    const stick = createStickToBottom(true);
    // Content grew while the view sat 100px above the new bottom.
    const node = fakeScroller(1000, 400, 500);

    stick.follow(node);
    expect(node.scrollTop).toBe(1000);
    expect(stick.isStuck()).toBe(true);
  });

  it("stops following after a single upward wheel gesture", () => {
    const stick = createStickToBottom(true);
    const node = fakeScroller(1000, 400, 500);

    stick.onWheel(-40);
    stick.follow(node);

    expect(stick.isStuck()).toBe(false);
    expect(node.scrollTop).toBe(500);
  });

  it("ignores its own programmatic scroll events", () => {
    const stick = createStickToBottom(true);
    const node = fakeScroller(1000, 400, 0);

    stick.follow(node); // scrollTop -> 1000, one suppressed event pending
    node.scrollTop = 600; // browser reports the programmatic scroll position
    expect(stick.onScroll(node)).toBeUndefined();
    expect(stick.isStuck()).toBe(true);
  });

  it("treats a user scroll away from the bottom as cancel until back at the bottom", () => {
    const stick = createStickToBottom(true);
    const node = fakeScroller(1000, 400, 300);

    expect(stick.onScroll(node)).toBe(300);
    expect(stick.isStuck()).toBe(false);

    // Content keeps streaming in, but follow() must not move the view.
    stick.follow(node);
    expect(node.scrollTop).toBe(300);

    // Scrolling back to the bottom re-arms following.
    node.scrollTop = 590;
    expect(stick.onScroll(node)).toBe(10);
    expect(stick.isStuck()).toBe(true);
  });

  it("queued follow-ups cannot override a user gesture between frames", () => {
    const stick = createStickToBottom(true);
    const node = fakeScroller(1000, 400, 500);

    stick.follow(node);
    expect(node.scrollTop).toBe(1000);

    // The user wheels up between the immediate scroll and the rAF re-run.
    stick.onWheel(-40);
    node.scrollTop = 480;
    stick.follow(node);

    expect(node.scrollTop).toBe(480);
  });

  it("does not leak suppressions when already at the bottom", () => {
    const stick = createStickToBottom(true);
    const node = fakeScroller(1000, 400, 0);

    stick.follow(node); // moves to bottom, suppression 1
    node.scrollTop = 600; // browser clamps to the real bottom
    expect(stick.onScroll(node)).toBeUndefined(); // consumes it
    stick.follow(node); // already at bottom: no scroll, no suppression

    // The next scroll event is a genuine user scroll and must count.
    node.scrollTop = 100;
    expect(stick.onScroll(node)).toBe(500);
    expect(stick.isStuck()).toBe(false);
  });
});
