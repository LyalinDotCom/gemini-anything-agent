import {
  ANTIGRAVITY_BASE_AGENT,
  GEMINI_API_REVISION,
  type ToolType
} from "./types";

export type ToolOption = {
  type: ToolType;
  label: string;
  detail: string;
};

export const managedAgentManifest = {
  docs: [
    {
      label: "Building Managed Agents",
      url: "https://ai.google.dev/gemini-api/docs/custom-agents",
      lastUpdated: "2026-06-22"
    },
    {
      label: "Agent Environments",
      url: "https://ai.google.dev/gemini-api/docs/agent-environment",
      lastUpdated: "2026-05-19"
    },
    {
      label: "Antigravity Agent",
      url: "https://ai.google.dev/gemini-api/docs/antigravity-agent",
      lastUpdated: "2026-05-19"
    }
  ],
  api: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiRevision: GEMINI_API_REVISION
  },
  baseAgents: [
    {
      id: ANTIGRAVITY_BASE_AGENT,
      label: "Antigravity preview",
      detail: "Current supported base_agent for managed agents."
    }
  ],
  creationStrategies: [
    {
      id: "sources",
      label: "From sources",
      detail: "Save system instructions, tools, and a declarative base_environment."
    },
    {
      id: "fork",
      label: "Fork environment",
      detail: "Create from an existing environment_id after iterating in a sandbox."
    }
  ],
  tools: [
    {
      type: "code_execution",
      label: "Code execution",
      detail: "Run Bash, Python, and Node commands in the managed sandbox."
    },
    {
      type: "google_search",
      label: "Google Search",
      detail: "Search the public web during an interaction."
    },
    {
      type: "url_context",
      label: "URL context",
      detail: "Fetch and read URLs during an interaction."
    }
  ] satisfies ToolOption[],
  environmentForms: [
    {
      id: "remote",
      label: "Fresh remote",
      detail: "Provision a clean Linux sandbox."
    },
    {
      id: "environment_id",
      label: "Environment ID",
      detail: "Reuse or fork an existing environment."
    },
    {
      id: "config",
      label: "Config object",
      detail: "Provision a sandbox with sources and network rules."
    }
  ],
  sourceTypes: [
    {
      type: "inline",
      label: "Inline file",
      detail: "Write text content into a target path.",
      limit: "1 MB per file, 2 MB total"
    },
    {
      type: "repository",
      label: "Git repository",
      detail: "Clone a repository URL into a target path.",
      limit: "500 MB"
    },
    {
      type: "gcs",
      label: "Cloud Storage",
      detail: "Copy a GCS file or directory into a target path.",
      limit: "2 GB"
    }
  ],
  networkModes: [
    {
      id: "unrestricted",
      label: "Unrestricted",
      detail: "Default outbound access."
    },
    {
      id: "allowlist",
      label: "Allowlist",
      detail: "Restrict outbound access and optionally inject headers."
    },
    {
      id: "disabled",
      label: "Disabled",
      detail: "No outbound network access."
    }
  ],
  limitations: [
    "Interactions is GA; managed agents and environments still use the preview/v1beta surface.",
    "Only antigravity-preview-05-2026 is currently supported as base_agent.",
    "Managed agents have no built-in versioning or rollback yet.",
    "Agent nesting and subagent delegation are not supported yet.",
    "Up to 1000 managed agents can be created."
  ]
} as const;

export const defaultToolTypes = managedAgentManifest.tools.map((tool) => tool.type);
