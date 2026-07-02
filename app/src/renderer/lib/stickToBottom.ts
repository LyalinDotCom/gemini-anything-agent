/**
 * Follow-the-stream scroll policy shared by the chat view and the transcript:
 * auto-scroll only while the user has never scrolled away; a single user
 * gesture (wheel up or dragging the scrollbar off the bottom) cancels
 * following; scrolling back to the bottom re-arms it.
 *
 * Programmatic scrolls are counted and their scroll events skipped, so the
 * controller never mistakes its own auto-scroll for user intent — and queued
 * follow-ups re-check `stuck`, so they can never override a user gesture that
 * happened between animation frames.
 */
export type StickToBottomController = {
  isStuck: () => boolean;
  setStuck: (value: boolean) => void;
  /** Scroll to the bottom if still following. Safe to call repeatedly. */
  follow: (node: HTMLElement | null) => void;
  /**
   * onScroll handler. Returns the distance from the bottom for user scrolls,
   * or undefined when the event came from our own follow().
   */
  onScroll: (node: HTMLElement | null) => number | undefined;
  /** onWheel handler: scrolling up is an explicit stop-following gesture. */
  onWheel: (deltaY: number) => void;
};

/** How close to the bottom counts as "scrolled back to the bottom". */
const RESTICK_THRESHOLD_PX = 24;

const distanceFromBottom = (node: HTMLElement): number =>
  node.scrollHeight - node.scrollTop - node.clientHeight;

export const createStickToBottom = (initiallyStuck = true): StickToBottomController => {
  let stuck = initiallyStuck;
  let suppressedScrollEvents = 0;

  return {
    isStuck: () => stuck,
    setStuck: (value: boolean) => {
      stuck = value;
    },
    follow: (node) => {
      if (!node || !stuck) {
        return;
      }
      if (distanceFromBottom(node) > 1) {
        // Only count a suppression when scrollTop actually changes; setting
        // the same value fires no scroll event and would leak the counter.
        suppressedScrollEvents += 1;
        node.scrollTop = node.scrollHeight;
      }
    },
    onScroll: (node) => {
      if (suppressedScrollEvents > 0) {
        suppressedScrollEvents -= 1;
        return undefined;
      }
      if (!node) {
        return undefined;
      }
      const distance = distanceFromBottom(node);
      stuck = distance < RESTICK_THRESHOLD_PX;
      return distance;
    },
    onWheel: (deltaY) => {
      if (deltaY < 0) {
        stuck = false;
      }
    }
  };
};
