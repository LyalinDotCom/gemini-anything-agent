import type { EnvironmentOutputFile } from "../../shared/electron-api";

export type EnvironmentOutputState = {
  loading: boolean;
  items: EnvironmentOutputFile[];
  error?: string;
  checked?: boolean;
};
