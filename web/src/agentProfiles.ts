import { CHAT_AGENT_ID, BROWSER_AGENT_ID, MODELS } from "./models";

export type AgentMode =
  | "antigravity"
  | "anything"
  | "browser"
  | "deep-research"
  | "deep-research-max";

export interface AgentProfile {
  mode: AgentMode;
  label: string;
  description: string;
  model: string;
  icon: string;
  agentId: string;
  managed: boolean;
  research: boolean;
  /** The client declares the full toolset on every turn (base-agent profiles). */
  clientToolset: boolean;
  /** The per-request context gets the browser-specialist invocation block. */
  browserPersona: boolean;
}

export const AGENT_PROFILES: Record<AgentMode, AgentProfile> = {
  antigravity: {
    mode: "antigravity",
    label: "Antigravity",
    description: "Fast, plain managed agent for general-purpose work.",
    model: "Antigravity preview",
    icon: "chat",
    agentId: MODELS.chatAgentBase,
    managed: false,
    research: false,
    clientToolset: true,
    browserPersona: false,
  },
  anything: {
    mode: "anything",
    label: "Anything",
    description: "Antigravity with media creation and browser tools.",
    model: "Antigravity preview",
    icon: "sparkle",
    agentId: CHAT_AGENT_ID,
    managed: true,
    research: false,
    clientToolset: false,
    browserPersona: false,
  },
  browser: {
    mode: "browser",
    label: "Browser",
    description: "Headless navigation, screenshots, and website testing.",
    model: "Antigravity preview",
    icon: "globe",
    agentId: BROWSER_AGENT_ID,
    managed: true,
    research: false,
    clientToolset: false,
    browserPersona: true,
  },
  "deep-research": {
    mode: "deep-research",
    label: "Deep Research",
    description: "Long-running research with sourced, structured reports.",
    model: "Deep Research preview",
    icon: "search",
    agentId: MODELS.deepResearch,
    managed: false,
    research: true,
    clientToolset: false,
    browserPersona: false,
  },
  "deep-research-max": {
    mode: "deep-research-max",
    label: "Deep Research Max",
    description: "Highest-effort research for complex investigations.",
    model: "Deep Research Max preview",
    icon: "brain",
    agentId: MODELS.deepResearchMax,
    managed: false,
    research: true,
    clientToolset: false,
    browserPersona: false,
  },
};

export const DEFAULT_AGENT_MODE: AgentMode = "antigravity";

export function profileForMode(mode: AgentMode | undefined): AgentProfile {
  return AGENT_PROFILES[mode ?? DEFAULT_AGENT_MODE];
}

/**
 * Resolve a session to its agent profile, including the legacy fallback for
 * sessions saved before agentMode existed (their research runs carried
 * mode: "deep-research"). Every resolution site must use this — the fallback
 * rule lives only here.
 */
export function profileForSession(session: {
  agentMode?: AgentMode;
  mode?: string;
}): AgentProfile {
  return profileForMode(
    session.agentMode ?? (session.mode === "deep-research" ? "deep-research" : undefined),
  );
}
