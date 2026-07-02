// The manual sidebar order is a local UI preference, not chat data, so it
// lives in localStorage rather than the on-disk chat store.
const ORDER_KEY = "gemini-anything-agent:conversation-order:v1";

export const readConversationOrder = (): string[] => {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ORDER_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
};

export const writeConversationOrder = (ids: string[]): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable — the order just won't survive a restart.
  }
};
