import { createHash } from "node:crypto";
import {
  normalizeAgentDefinition,
  type AgentDefinition,
  type ManagedAgent
} from "../sdk";

export const comparableAgentDefinition = (
  agent: ManagedAgent | AgentDefinition
): AgentDefinition =>
  normalizeAgentDefinition({
    id: agent.id,
    description: agent.description,
    base_agent: agent.base_agent,
    system_instruction: agent.system_instruction,
    tools: agent.tools,
    base_environment: agent.base_environment
  });

export const agentConfigHash = (agent: ManagedAgent | AgentDefinition): string => {
  const comparable = comparableAgentDefinition(agent);
  delete comparable.description;
  // Only this digest is exposed in the description. Hash source contents before
  // renderer redaction so rotating a sandbox credential forces a redeploy.
  return createHash("sha256").update(JSON.stringify(comparable)).digest("hex").slice(0, 12);
};
