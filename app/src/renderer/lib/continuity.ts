import type { InteractionCreateRequest } from "@sdk";
import type { Session } from "./builderState";
import { interactionIsSuccessfulTerminal } from "./sessionState";

export const sessionEnvironmentId = (session: Session): string | undefined => {
  const environmentId = session.seed?.environment_id;
  return typeof environmentId === "string" && environmentId.trim() ? environmentId.trim() : undefined;
};

const successfulTerminalSessions = (
  sessions: Session[],
  agentId: string
): Session[] =>
  sessions.filter(
    (session) =>
      session.agentId === agentId &&
      Boolean(session.seed?.id) &&
      !session.error &&
      !session.streaming &&
      Boolean(session.seed && interactionIsSuccessfulTerminal(session.seed))
  );

export const latestContinuableSession = (
  sessions: Session[],
  agentId: string
): Session | undefined =>
  successfulTerminalSessions(sessions, agentId)
    .filter((session) => session.request.store === true)
    .sort((left, right) => right.startedAt - left.startedAt)[0];

export const latestReusableEnvironmentSession = (
  sessions: Session[],
  agentId: string
): Session | undefined =>
  successfulTerminalSessions(sessions, agentId)
    .filter(
      (session) =>
        Boolean(sessionEnvironmentId(session))
    )
    .sort((left, right) => right.startedAt - left.startedAt)[0];

export const withAutoContinuity = (
  request: InteractionCreateRequest,
  sessions: Session[],
  options: { autoContinue: boolean; reuseEnvironment: boolean }
): InteractionCreateRequest => {
  const shouldContinue = options.autoContinue && request.store === true && !request.previous_interaction_id;
  const shouldReuseEnvironment = options.reuseEnvironment && request.environment === "remote";

  if (!shouldContinue && !shouldReuseEnvironment) {
    return request;
  }

  const latest = successfulTerminalSessions(sessions, request.agent)
    .sort((left, right) => right.startedAt - left.startedAt)[0];
  if (!latest) {
    return request;
  }

  const next: InteractionCreateRequest = { ...request };
  if (shouldContinue && latest.request.store === true && latest.seed?.id) {
    next.previous_interaction_id = latest.seed.id;
  }

  const environmentId = sessionEnvironmentId(latest);
  if (shouldReuseEnvironment && environmentId) {
    next.environment = environmentId;
  }

  return next;
};

export const withAutoContinuation = (
  request: InteractionCreateRequest,
  sessions: Session[],
  autoContinue: boolean
): InteractionCreateRequest => {
  if (!autoContinue || request.store !== true || request.previous_interaction_id) {
    return request;
  }

  const latest = latestContinuableSession(sessions, request.agent);
  return latest?.seed?.id ? { ...request, previous_interaction_id: latest.seed.id } : request;
};

export const withAutoEnvironment = (
  request: InteractionCreateRequest,
  sessions: Session[],
  reuseEnvironment: boolean
): InteractionCreateRequest => {
  if (!reuseEnvironment || request.environment !== "remote") {
    return request;
  }

  const latest = latestReusableEnvironmentSession(sessions, request.agent);
  const environmentId = latest ? sessionEnvironmentId(latest) : undefined;
  return environmentId ? { ...request, environment: environmentId } : request;
};
