import type { InteractionCreateRequest } from "@sdk";
import type { Session } from "./builderState";
import { sessionEnvironmentId } from "./continuity";
import { promptForInput } from "./interactionInput";

export type ConversationSummary = {
  id: string;
  title: string;
  sessions: Session[];
  latestAt: number;
  environmentId?: string;
  draft?: boolean;
  running?: boolean;
};

export const NEW_CONVERSATION_ID = "new";

export const NEW_CONVERSATION_DRAFT: ConversationSummary = {
  id: NEW_CONVERSATION_ID,
  title: "New chat",
  sessions: [],
  latestAt: 0,
  draft: true,
  running: false
};

export const visibleConversationsWithDraft = ({
  activeConversationId,
  conversations,
  draftVisible,
  startingConversationIds
}: {
  activeConversationId: string;
  conversations: ConversationSummary[];
  draftVisible: boolean;
  startingConversationIds: Record<string, boolean>;
}): ConversationSummary[] => {
  const showDraft =
    draftVisible ||
    activeConversationId === NEW_CONVERSATION_ID ||
    Boolean(startingConversationIds[NEW_CONVERSATION_ID]);
  const conversationsWithStarting = conversations.map((conversation) => ({
    ...conversation,
    running: Boolean(conversation.running || startingConversationIds[conversation.id])
  }));

  return showDraft
    ? [
        {
          ...NEW_CONVERSATION_DRAFT,
          running: Boolean(startingConversationIds[NEW_CONVERSATION_ID])
        },
        ...conversationsWithStarting
      ]
    : conversationsWithStarting;
};

export const firstPromptLine = (input: InteractionCreateRequest["input"]): string => {
  const prompt = promptForInput(input).trim().replace(/\s+/g, " ");
  if (!prompt) {
    return "Untitled conversation";
  }
  return prompt.length > 54 ? `${prompt.slice(0, 53)}...` : prompt;
};

export const formatConversationTime = (value: number): string =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });

const conversationRootId = (
  session: Session,
  byId: Map<string, Session>
): string => {
  let current = session;
  const seen = new Set<string>();
  while (current.parentLocalId && byId.has(current.parentLocalId) && !seen.has(current.localId)) {
    seen.add(current.localId);
    current = byId.get(current.parentLocalId)!;
  }
  return current.localId;
};

export const buildConversations = (agentSessions: Session[]): ConversationSummary[] => {
  const byId = new Map(agentSessions.map((session) => [session.localId, session]));
  const grouped = new Map<string, Session[]>();
  for (const session of agentSessions) {
    const rootId = conversationRootId(session, byId);
    grouped.set(rootId, [...(grouped.get(rootId) ?? []), session]);
  }

  return [...grouped.entries()]
    .map(([id, group]) => {
      const sorted = [...group].sort((left, right) => left.startedAt - right.startedAt);
      const latestAt = sorted.reduce((max, session) => Math.max(max, session.startedAt), 0);
      return {
        id,
        title: firstPromptLine(sorted[0]?.request.input ?? ""),
        sessions: sorted,
        latestAt,
        environmentId: [...sorted].reverse().map(sessionEnvironmentId).find((value): value is string => Boolean(value)),
        running: sorted.some((session) => session.streaming)
      };
    })
    .sort((left, right) => right.latestAt - left.latestAt);
};
