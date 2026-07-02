import type {
  EnvironmentSource,
  ManagedAgent,
  NetworkRule,
  ToolConfig,
  ToolType
} from "@sdk";
import {
  minimalBuilder,
  slug,
  uid,
  type BuilderDraft,
  type NetworkMode,
  type ProjectFileDraft,
  type NetworkRuleDraft,
  type SourceDraft
} from "./builderState";

const toolType = (tool: ToolConfig): ToolType | undefined => {
  const type = typeof tool === "string" ? tool : tool.type;
  return type === "code_execution" || type === "google_search" || type === "url_context"
    ? type
    : undefined;
};

const ruleToDraft = (rule: NetworkRule): NetworkRuleDraft => ({
  id: uid(),
  domain: rule.domain,
  headers: Object.entries(rule.transform ?? {}).map(([key, value]) => ({
    id: uid(),
    key,
    value
  }))
});

const sourceToDraft = (source: EnvironmentSource): SourceDraft =>
  source.type === "inline"
    ? { id: uid(), type: "inline", source: "", target: source.target, content: source.content }
    : { id: uid(), type: source.type, source: source.source, target: source.target, content: "" };

const sourceToProjectFile = (source: EnvironmentSource): ProjectFileDraft | undefined => {
  if (source.type !== "inline") {
    return undefined;
  }
  if (source.target === ".agents/AGENTS.md") {
    return {
      id: uid(),
      kind: "instructions",
      name: "AGENTS.md",
      target: source.target,
      content: source.content
    };
  }
  if (source.target === ".env") {
    return {
      id: uid(),
      kind: "env",
      name: ".env",
      target: ".env",
      content: source.content
    };
  }
  const skill = source.target.match(/^\.agents\/([^/]+)\/SKILL\.md$/);
  if (skill) {
    return {
      id: uid(),
      kind: "skill",
      name: skill[1],
      target: source.target,
      content: source.content
    };
  }
  const assetName = source.target.split("/").pop() ?? "asset";
  return {
    id: uid(),
    kind: "asset",
    name: slug(assetName, "asset"),
    target: source.target,
    content: source.content
  };
};

/**
 * Round-trip a ManagedAgent (from GET /agents or Clone) back into an editable
 * BuilderDraft using only the fields represented in the builder UI.
 */
export const agentToDraft = (agent: ManagedAgent): BuilderDraft => {
  const draft = minimalBuilder();
  draft.id = agent.id ?? draft.id;
  draft.description = agent.description ?? "";
  draft.systemInstruction = agent.system_instruction ?? "";
  draft.projectFiles = [];

  if (Array.isArray(agent.tools)) {
    draft.toolMode = "custom";
    const enabled = new Set(agent.tools.map(toolType).filter(Boolean) as ToolType[]);
    draft.selectedTools = {
      code_execution: enabled.has("code_execution"),
      google_search: enabled.has("google_search"),
      url_context: enabled.has("url_context")
    };
  }

  const env = agent.base_environment;
  if (typeof env === "string" && env !== "remote") {
    draft.environmentMode = "environment_id";
    draft.environmentId = env;
  } else if (env && typeof env === "object") {
    draft.environmentMode = "config";
    draft.projectFiles = (env.sources ?? [])
      .map(sourceToProjectFile)
      .filter((file): file is ProjectFileDraft => Boolean(file));
    const activeEnv = draft.projectFiles.find((file) => file.kind === "env");
    if (activeEnv) {
      draft.activeEnvFileId = activeEnv.id;
    }
    draft.sources = (env.sources ?? [])
      .filter((source) => source.type !== "inline" || !sourceToProjectFile(source))
      .map(sourceToDraft);
    if (env.network === "disabled") {
      draft.networkMode = "disabled";
    } else if (env.network && typeof env.network === "object") {
      draft.networkMode = "allowlist" as NetworkMode;
      draft.networkRules = Array.isArray(env.network.allowlist)
        ? env.network.allowlist.map(ruleToDraft)
        : [];
    }
  }

  return draft;
};
