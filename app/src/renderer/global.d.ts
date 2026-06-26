import type { ManagedAgentsBridge } from "../shared/electron-api";

declare global {
  interface Window {
    managedAgents?: ManagedAgentsBridge;
  }
}

export {};

