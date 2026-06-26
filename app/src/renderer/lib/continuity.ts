import type { InteractionCreateRequest } from "@sdk";
import type { Session } from "./builderState";

export const sessionEnvironmentId = (session: Session): string | undefined => {
  const environmentId = session.seed?.environment_id;
  return typeof environmentId === "string" && environmentId.trim() ? environmentId.trim() : undefined;
};

export const latestContinuableSession = (
  sessions: Session[],
  agentId: string
): Session | undefined =>
  sessions
    .filter(
      (session) =>
        session.agentId === agentId &&
        session.request.store === true &&
        Boolean(session.seed?.id) &&
        !session.error &&
        !session.streaming
    )
    .sort((left, right) => right.startedAt - left.startedAt)[0];

export const latestReusableEnvironmentSession = (
  sessions: Session[],
  agentId: string
): Session | undefined =>
  sessions
    .filter(
      (session) =>
        session.agentId === agentId &&
        Boolean(sessionEnvironmentId(session)) &&
        !session.error &&
        !session.streaming
    )
    .sort((left, right) => right.startedAt - left.startedAt)[0];

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
