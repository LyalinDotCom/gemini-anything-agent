import { DEFAULT_RUN_OPTIONS, type RunOptions } from "./types";
import { isHarnessModel } from "../models";

/** One defaulting layer for every reader: sessions persist only what the user
 *  changed; everything else tracks the live defaults. */
export function effectiveRunOptions(session: { runOptions?: RunOptions; agentMode?: string }): RunOptions {
  const options = { ...DEFAULT_RUN_OPTIONS, ...(session.runOptions ?? {}) };
  if (!isHarnessModel(options.agentModel)) options.agentModel = DEFAULT_RUN_OPTIONS.agentModel;
  return (session.agentMode === "object3d" || session.agentMode === "large-image") ? { ...options, store: true, background: true } : options;
}

// Scalar options the composer badge counts, compared against their defaults.
// The payload fields behind the override booleans (systemInstruction, toolTypes,
// environmentId) are represented by their booleans, not their content.
const COUNTED_KEYS = [
  "agentModel",
  "store",
  "autoContinue",
  "reuseEnvironment",
  "background",
  "serviceTier",

  "overrideSystemInstruction",
  "overrideTools",
  "overrideEnvironment",
  "useCredential",
] as const;

export function runOptionCount(options: RunOptions): number {
  return (
    COUNTED_KEYS.filter((key) => options[key] !== DEFAULT_RUN_OPTIONS[key]).length +
    Number(Boolean(options.previousInteractionId.trim()))
  );
}
