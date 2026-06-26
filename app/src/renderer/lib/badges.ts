import { resolveActiveEnvFile, type BuilderDraft } from "./builderState";

/**
 * The visual grammar that answers the #1 question: for any field, is this a
 * DEFAULT (omittable), something you have CUSTOMized, a REQUIRED field, a FIXED
 * constant, or an opt-in ADD-ON?
 */
export type BadgeState = "required" | "fixed" | "default" | "custom" | "addon";

export type CapabilityKey = "identity" | "baseAgent" | "brain" | "tools" | "environment" | "network";

export type CardDescriptor = {
  state: BadgeState;
  /** True when this capability contributes a key to the agent payload. Must match buildAgent exactly. */
  emitsKey: boolean;
  /** The mandatory "Omitted -> ..." teaching line stating the real API fallback. */
  omittedNote: string;
  jsonPath?: string;
};

export const BADGE_LABEL: Record<BadgeState, string> = {
  required: "Required",
  fixed: "Fixed",
  default: "Default",
  custom: "Custom",
  addon: "Add-on"
};

export const BADGE_HINT: Record<BadgeState, string> = {
  required: "The API rejects the request without this. Always sent.",
  fixed: "Required, but only one option is available today.",
  default: "Omittable. Sent nothing -> the API applies its built-in default.",
  custom: "You set this explicitly, so it is now part of the payload.",
  addon: "An optional capability that does not exist until you add it."
};

const toolCount = (draft: BuilderDraft): number =>
  (["code_execution", "google_search", "url_context"] as const).filter(
    (type) => draft.selectedTools[type]
  ).length;

/**
 * Single source of truth for a card's badge. computeCardState reads the SAME
 * booleans that lib/payload.ts uses to decide whether to emit a key, so a card
 * can never show CUSTOM without its key in the payload (or DEFAULT with it).
 */
export const computeCardState = (draft: BuilderDraft, key: CapabilityKey): CardDescriptor => {
  switch (key) {
    case "identity":
      return {
        state: "required",
        emitsKey: true,
        omittedNote: "",
        jsonPath: "id"
      };
    case "baseAgent":
      return {
        state: "fixed",
        emitsKey: true,
        omittedNote: "Only antigravity-preview-05-2026 is supported today.",
        jsonPath: "base_agent"
      };
    case "brain": {
      const emits = draft.systemInstruction.trim().length > 0;
      return {
        state: emits ? "custom" : "default",
        emitsKey: emits,
        omittedNote: "Omitted -> the base agent's built-in persona and behavior.",
        jsonPath: "system_instruction"
      };
    }
    case "tools": {
      // Custom-but-zero-tools normalizes to an omitted key, so it must read as Default.
      const emits = draft.toolMode === "custom" && toolCount(draft) > 0;
      return {
        state: emits ? "custom" : "default",
        emitsKey: emits,
        omittedNote: "Omitted -> inherits all of the base agent's default tools.",
        jsonPath: "tools"
      };
    }
    case "environment": {
      // Only the active .env is baked into the sandbox, so inactive .env files
      // (a local library) must not flip this card to Custom on their own.
      const activeEnvId = resolveActiveEnvFile(draft)?.id;
      const hasSourceContent = draft.projectFiles.some((file) =>
        file.kind === "env"
          ? file.id === activeEnvId && file.content.trim().length > 0
          : file.content.trim().length > 0
      );
      const emits = draft.environmentMode !== "remote" || hasSourceContent;
      return {
        state: emits ? "custom" : "default",
        emitsKey: emits,
        omittedNote: "Omitted -> a fresh, clean remote Linux sandbox for every run.",
        jsonPath: "base_environment"
      };
    }
    case "network": {
      const omittedNote = "Omitted -> unrestricted outbound network access.";
      const jsonPath = "base_environment.network";
      const asDefault = { state: "default" as const, emitsKey: false, omittedNote, jsonPath };
      // network only reaches the wire inside a config base_environment.
      if (draft.environmentMode !== "config") {
        return asDefault;
      }
      if (draft.networkMode === "disabled") {
        return { state: "addon", emitsKey: true, omittedNote, jsonPath };
      }
      if (draft.networkMode === "allowlist") {
        const hasRule = draft.networkRules.some((rule) => rule.domain.trim().length > 0);
        return hasRule ? { state: "addon", emitsKey: true, omittedNote, jsonPath } : asDefault;
      }
      return asDefault;
    }
    default:
      return { state: "default", emitsKey: false, omittedNote: "" };
  }
};

export const toolsBadgeCount = (draft: BuilderDraft): string =>
  draft.toolMode === "custom" ? `${toolCount(draft)}/3` : "";
