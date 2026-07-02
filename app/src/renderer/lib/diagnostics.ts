import { NEW_CONVERSATION_ID } from "./conversations";

/**
 * Appends a runtime diagnostic line to the conversation's on-disk folder
 * (chats/<conversation>/diagnostics.log) via a fire-and-forget IPC send.
 * Never throws; diagnostics must not affect app behavior.
 */
export const logConversationDiagnostic = (
  conversationId: string | undefined,
  event: string,
  detail?: unknown
): void => {
  if (
    !conversationId ||
    conversationId === NEW_CONVERSATION_ID ||
    typeof window === "undefined" ||
    !window.managedAgents?.appendConversationDiagnostics
  ) {
    return;
  }
  try {
    window.managedAgents.appendConversationDiagnostics(conversationId, {
      at: new Date().toISOString(),
      event,
      detail:
        detail === undefined
          ? undefined
          : typeof detail === "string"
            ? detail
            : JSON.stringify(detail)
    });
  } catch {
    // Fire-and-forget.
  }
};
