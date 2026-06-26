import type { Interaction } from "./types";

const textParts = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((part) => {
    if (!part || typeof part !== "object") {
      return [];
    }
    const record = part as Record<string, unknown>;
    return typeof record.text === "string" ? [record.text] : [];
  });
};

export const extractInteractionOutputText = (
  interaction: Interaction | undefined
): string | undefined => {
  if (interaction?.output_text?.trim()) {
    return interaction.output_text;
  }

  const chunks =
    interaction?.steps?.flatMap((step) => {
      if (!step || typeof step !== "object") {
        return [];
      }
      const record = step as Record<string, unknown>;
      if (record.type !== "model_output") {
        return [];
      }
      return [...textParts(record.content), ...textParts(record.output)];
    }) ?? [];

  const text = chunks.join("\n").trim();
  return text.length > 0 ? text : undefined;
};
