import type { EnvironmentOutputFile, ResolvedEnvironmentMedia } from "../../shared/electron-api";

export type SessionMediaState = {
  loading: boolean;
  items: ResolvedEnvironmentMedia[];
  error?: string;
  progress?: number;
  stage?: string;
};

export type EnvironmentOutputState = {
  loading: boolean;
  items: EnvironmentOutputFile[];
  error?: string;
  checked?: boolean;
};
