import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { UsageError } from "../errors.js";
import { createGenAIClient } from "../genaiClient.js";
import { defaultEmbedModel } from "../models.js";
import { ensureParentDir } from "../output.js";
import type { CommandResult } from "../types.js";

type EmbedOptions = {
  out?: string;
  file?: string;
  model?: string;
  dim?: string;
  json?: boolean;
  dryRun?: boolean;
};

const readInputText = async (text: string | undefined, options: EmbedOptions): Promise<string> => {
  if (text && options.file) {
    throw new UsageError("Provide a text argument or --file, not both.");
  }
  if (options.file) {
    return (await readFile(resolve(options.file), "utf8")).trim();
  }
  if (!text?.trim()) {
    throw new UsageError("Provide text to embed as an argument or via --file.");
  }
  return text.trim();
};

export const runEmbed = async (text: string | undefined, options: EmbedOptions): Promise<CommandResult> => {
  const model = options.model || defaultEmbedModel();
  const input = await readInputText(text, options);
  const outputDimensionality = options.dim ? Number.parseInt(options.dim, 10) : undefined;
  if (options.dim && (!Number.isFinite(outputDimensionality) || (outputDimensionality as number) <= 0)) {
    throw new UsageError(`--dim must be a positive integer, got "${options.dim}".`);
  }

  if (options.dryRun) {
    return {
      ok: true,
      capability: "embed",
      model,
      message: "dry run",
      details: {
        apiSurface: "embedContent",
        characters: input.length,
        outputDimensionality
      }
    };
  }

  const ai = createGenAIClient();
  const response = (await ai.models.embedContent({
    model,
    contents: input,
    ...(outputDimensionality ? { config: { outputDimensionality } } : {})
  } as never)) as {
    embeddings?: Array<{ values?: number[] }>;
  };

  const values = response.embeddings?.[0]?.values;
  if (!values || values.length === 0) {
    throw new Error(`Embedding model ${model} did not return embedding values.`);
  }

  const outputs = [];
  if (options.out) {
    const path = resolve(options.out);
    await ensureParentDir(path);
    await writeFile(path, `${JSON.stringify(values)}\n`, "utf8");
    outputs.push({ path, mimeType: "application/json" });
  }

  return {
    ok: true,
    capability: "embed",
    model,
    ...(outputs.length > 0 ? { outputs } : {}),
    message: `Embedded ${input.length} characters into ${values.length} dimensions.`,
    details: {
      dimensions: values.length,
      values
    }
  };
};
