import type { ManagedAgent } from "@sdk";

export const trimVersionSuffix = (id: string): string => id.trim().replace(/-v\d+$/i, "");

export const nextAgentVersionId = (id: string, agents: Pick<ManagedAgent, "id">[]): string => {
  const base = trimVersionSuffix(id) || "my-first-agent";
  const existing = new Set(agents.map((agent) => agent.id).filter(Boolean));
  if (!existing.has(base)) {
    return base;
  }
  let version = 2;
  while (existing.has(`${base}-v${version}`)) {
    version += 1;
  }
  return `${base}-v${version}`;
};
