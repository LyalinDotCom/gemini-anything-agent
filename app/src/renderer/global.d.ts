import type { DetailedHTMLProps, HTMLAttributes } from "react";
import type { ManagedAgentsBridge } from "../shared/electron-api";

declare module "*.png" {
  const src: string;
  export default src;
}

declare global {
  interface Window {
    managedAgents?: ManagedAgentsBridge;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        partition?: string;
        allowpopups?: string | boolean;
      };
    }
  }
}

export {};
