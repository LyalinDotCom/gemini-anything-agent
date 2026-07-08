import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { UsageError } from "../errors.js";
import { createGenAIClient } from "../genaiClient.js";
import { defaultTextModel } from "../models.js";
import type { CommandResult } from "../types.js";

type TokensOptions = {
  file?: string;
  model?: string;
  json?: boolean;
};

export const runTokens = async (text: string | undefined, options: TokensOptions): Promise<CommandResult> => {
  if (text && options.file) {
    throw new UsageError("Provide a text argument or --file, not both.");
  }
  const input = options.file ? await readFile(resolve(options.file), "utf8") : text;
  if (!input?.trim()) {
    throw new UsageError("Provide text to count as an argument or via --file.");
  }

  const model = options.model || defaultTextModel();
  const ai = createGenAIClient();
  const response = (await ai.models.countTokens({
    model,
    contents: input
  } as never)) as {
    totalTokens?: number;
  };

  if (typeof response.totalTokens !== "number") {
    throw new Error(`Model ${model} did not return a token count.`);
  }

  return {
    ok: true,
    capability: "tokens",
    model,
    stdout: String(response.totalTokens),
    details: {
      totalTokens: response.totalTokens,
      characters: input.length
    }
  };
};
