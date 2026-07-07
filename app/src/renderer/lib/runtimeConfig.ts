import { managedAgentManifest } from "@sdk";
import type { IpcError, RuntimeConfig } from "../../shared/electron-api";

export const FALLBACK_RUNTIME: RuntimeConfig = {
  hasApiKey: false,
  apiRevision: managedAgentManifest.api.apiRevision,
  baseUrl: managedAgentManifest.api.baseUrl,
  envPath: ".env",
  chatStorePath: "chats",
  docsLastChecked: "2026-06-22",
  agentId: "gemini-anything-v1",
  npmPackage: "@lyalindotcom/gai",
  npmVersion: "latest",
  specializedToolsEnabled: true
};

export const bridgeUnavailable: IpcError = {
  name: "BridgeUnavailable",
  message: "Run the Electron app with npm run dev for live managed-agent calls."
};
