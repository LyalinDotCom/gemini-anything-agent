import {
  DEEP_RESEARCH_AGENT,
  DEEP_RESEARCH_MAX_AGENT,
  type InteractionCreateRequest,
  type InteractionInput,
  type ToolType
} from "@sdk";
import {
  initialCompose,
  uid,
  type AgentMode,
  type ComposeState,
  type ImageAttachmentMeta,
  type ImagePartDraft
} from "./builderState";

export type PendingComposeInput = Pick<ComposeState, "inputMode" | "input" | "parts">;

export const ALL_AGENT_TOOLS: ToolType[] = ["code_execution", "google_search", "url_context"];

export const composeInputSnapshot = (state: ComposeState): PendingComposeInput => ({
  inputMode: state.inputMode,
  input: state.input,
  parts: state.parts.map((part) => ({ ...part }))
});

export const clearComposeInput = (state: ComposeState): ComposeState => ({
  ...state,
  input: "",
  parts: []
});

export const restoreComposeInput = (
  state: ComposeState,
  snapshot: PendingComposeInput
): ComposeState => ({
  ...state,
  inputMode: snapshot.inputMode,
  input: snapshot.input,
  parts: snapshot.parts.map((part) => ({ ...part }))
});

const composeToInput = (compose: ComposeState): InteractionInput => {
  const images = compose.parts.filter((part): part is ImagePartDraft => part.kind === "image");
  const text = compose.input.trim();
  if (images.length === 0) {
    return compose.input;
  }
  return [
    ...(text ? [{ type: "text" as const, text: compose.input }] : []),
    ...images.map((part) => ({ type: "image" as const, data: part.data, mime_type: part.mimeType }))
  ];
};

export const imageAttachmentsFromCompose = (compose: ComposeState): ImageAttachmentMeta[] | undefined => {
  const attachments = compose.parts
    .filter((part): part is ImagePartDraft => part.kind === "image")
    .map((part) => ({
      id: part.id,
      name: part.name,
      path: part.path,
      bytes: part.bytes,
      mimeType: part.mimeType
    }));
  return attachments.length ? attachments : undefined;
};

export const imagePartsFromRequest = (
  request: InteractionCreateRequest,
  metadata: ImageAttachmentMeta[] = []
): ImagePartDraft[] => {
  if (!Array.isArray(request.input)) {
    return [];
  }
  let imageIndex = 0;
  return request.input.flatMap((part): ImagePartDraft[] => {
    if (part.type !== "image") {
      return [];
    }
    const meta = metadata[imageIndex];
    imageIndex += 1;
    return [
      {
        id: meta?.id ?? `sent-image-${imageIndex}`,
        kind: "image",
        data: part.data,
        mimeType: meta?.mimeType ?? part.mime_type,
        name: meta?.name ?? `sent-image-${imageIndex}`,
        path: meta?.path,
        bytes: meta?.bytes ?? Math.ceil((part.data.length * 3) / 4)
      }
    ];
  });
};

export const mergeImageParts = (parts: ImagePartDraft[]): ImagePartDraft[] => {
  const seen = new Set<string>();
  const merged: ImagePartDraft[] = [];
  for (const part of parts) {
    const key = `${part.id}:${part.mimeType}:${part.data.length}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(part);
  }
  return merged;
};

export const hasComposeInput = (compose: ComposeState): boolean =>
  compose.input.trim().length > 0 || compose.parts.some((part) => part.kind === "image");

export const deepResearchAgentIdForMode = (mode: AgentMode): string | undefined =>
  mode === "deep-research"
    ? DEEP_RESEARCH_AGENT
    : mode === "deep-research-max"
      ? DEEP_RESEARCH_MAX_AGENT
      : undefined;

export const agentModeForAgentId = (agentId: string): AgentMode => {
  const id = agentId.trim();
  if (id === DEEP_RESEARCH_AGENT) {
    return "deep-research";
  }
  if (id === DEEP_RESEARCH_MAX_AGENT) {
    return "deep-research-max";
  }
  return "anything";
};

export const buildChatInteraction = (
  agentId: string,
  compose: ComposeState
): InteractionCreateRequest => {
  const deepResearchAgent = deepResearchAgentIdForMode(compose.agentMode);
  if (deepResearchAgent) {
    // Deep Research is invoked directly by base-agent id and requires
    // background execution with stored history; per-run system-instruction,
    // tool, and environment overrides do not apply to it.
    const request: InteractionCreateRequest = {
      agent: deepResearchAgent,
      input: composeToInput(compose),
      environment: "remote",
      store: true,
      background: true,
      agent_config: {
        type: "deep-research",
        ...(compose.thinkingSummaries !== "none"
          ? { thinking_summaries: compose.thinkingSummaries }
          : {})
      }
    };
    if (compose.previousInteractionId.trim()) {
      request.previous_interaction_id = compose.previousInteractionId.trim();
    }
    return request;
  }

  const request: InteractionCreateRequest = {
    agent: agentId,
    input: composeToInput(compose),
    environment: "remote",
    store: compose.store
  };

  if (compose.background && compose.store) {
    request.background = true;
  }
  if (compose.serviceTier !== "standard") {
    request.service_tier = compose.serviceTier;
  }
  if (compose.thinkingSummaries !== "none") {
    request.agent_config = {
      type: "dynamic",
      thinking_summaries: compose.thinkingSummaries
    };
  }
  if (compose.previousInteractionId.trim()) {
    request.previous_interaction_id = compose.previousInteractionId.trim();
  }
  if (compose.overrideSystemInstruction && compose.systemInstruction.trim()) {
    request.system_instruction = compose.systemInstruction.trim();
  }
  if (compose.overrideTools) {
    request.tools = ALL_AGENT_TOOLS.map((type) => ({ type }));
  }
  if (compose.overrideEnvironment && compose.environmentId.trim()) {
    request.environment = compose.environmentId.trim();
  }

  return request;
};

export const promptForInput = (input: InteractionCreateRequest["input"]): string => {
  if (typeof input === "string") {
    return input;
  }
  return input
    .map((part) => (part.type === "text" ? part.text : `[${part.mime_type} image]`))
    .join("\n")
    .trim();
};

export const composeFromRequest = (request: InteractionCreateRequest): ComposeState => {
  const input = typeof request.input === "string"
    ? request.input
    : request.input
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
  const parts = Array.isArray(request.input)
    ? request.input.flatMap((part, index): ImagePartDraft[] =>
        part.type === "image"
          ? [
              {
                id: uid(),
                kind: "image",
                data: part.data,
                mimeType: part.mime_type,
                name: `attached-image-${index + 1}`,
                bytes: Math.round((part.data.length * 3) / 4)
              }
            ]
          : []
      )
    : [];
  const environmentId =
    typeof request.environment === "string" && request.environment !== "remote" ? request.environment : "";

  return {
    ...initialCompose,
    inputMode: parts.length ? "parts" : "string",
    input,
    parts,
    agentMode: agentModeForAgentId(request.agent),
    store: request.store ?? initialCompose.store,
    autoContinue: !request.previous_interaction_id,
    reuseEnvironment: request.environment === "remote",
    background: request.background ?? initialCompose.background,
    serviceTier: request.service_tier ?? initialCompose.serviceTier,
    thinkingSummaries: request.agent_config?.thinking_summaries ?? initialCompose.thinkingSummaries,
    previousInteractionId: request.previous_interaction_id ?? "",
    overrideSystemInstruction: Boolean(request.system_instruction),
    systemInstruction: request.system_instruction ?? "",
    overrideTools: Boolean(request.tools?.length),
    overrideEnvironment: Boolean(environmentId),
    environmentId
  };
};
