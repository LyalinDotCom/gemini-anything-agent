import { DEFAULT_RUN_OPTIONS, type RunOptions } from "./types";

/** One defaulting layer for every reader: sessions persist only what the user
 *  changed; everything else tracks the live defaults. */
export function effectiveRunOptions(session: { runOptions?: RunOptions }): RunOptions {
  return { ...DEFAULT_RUN_OPTIONS, ...(session.runOptions ?? {}) };
}

// Scalar options the composer badge counts, compared against their defaults.
// The payload fields behind the override booleans (systemInstruction, toolTypes,
// environmentId) are represented by their booleans, not their content.
const COUNTED_KEYS = [
  "store",
  "autoContinue",
  "reuseEnvironment",
  "background",
  "serviceTier",
  "thinkingSummaries",
  "overrideSystemInstruction",
  "overrideTools",
  "overrideEnvironment",
] as const;

export function runOptionCount(options: RunOptions): number {
  return (
    COUNTED_KEYS.filter((key) => options[key] !== DEFAULT_RUN_OPTIONS[key]).length +
    Number(Boolean(options.previousInteractionId.trim()))
  );
}
