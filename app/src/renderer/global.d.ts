import type { ManagedAgentsBridge } from "../shared/electron-api";

declare module "*.png" {
  const src: string;
  export default src;
}

declare global {
  interface Window {
    managedAgents?: ManagedAgentsBridge;
  }
}

export {};
