import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { lookup as lookupMime } from "mime-types";
import { UsageError } from "../errors.js";
import { createGenAIClient } from "../genaiClient.js";
import { defaultTextModel } from "../models.js";
import { ensureParentDir } from "../output.js";
import type { CommandResult } from "../types.js";

type GenerateOptions = {
  out?: string;
  model?: string;
  system?: string;
  systemFile?: string;
  file?: string[];
  schema?: string;
  search?: boolean;
  urlContext?: boolean;
  codeExecution?: boolean;
  temperature?: string;
  maxTokens?: string;
  json?: boolean;
  dryRun?: boolean;
};

type InputPart = Record<string, string>;

const partTypeForMime = (mimeType: string): string => {
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("audio/")) {
    return "audio";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  return "file";
};

const inputPartForFile = async (path: string): Promise<InputPart> => {
  const resolved = resolve(path);
  const mimeType = lookupMime(resolved) || "application/octet-stream";
  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return {
      type: "text",
      text: await readFile(resolved, "utf8")
    };
  }
  const data = await readFile(resolved);
  return {
    type: partTypeForMime(mimeType),
    data: data.toString("base64"),
    mime_type: mimeType
  };
};

const parseSchema = async (value: string): Promise<Record<string, unknown>> => {
  const trimmed = value.trim();
  const source = trimmed.startsWith("{") ? trimmed : await readFile(resolve(trimmed), "utf8");
  try {
    const parsed = JSON.parse(source) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("schema must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new UsageError(
      `--schema must be inline JSON or a path to a JSON Schema file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

const readSystemInstruction = async (options: GenerateOptions): Promise<string | undefined> => {
  if (options.system && options.systemFile) {
    throw new UsageError("Provide --system or --system-file, not both.");
  }
  if (options.systemFile) {
    return (await readFile(resolve(options.systemFile), "utf8")).trim();
  }
  return options.system?.trim() || undefined;
};

const parseNumber = (value: string | undefined, flag: string): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new UsageError(`${flag} must be a number, got "${value}".`);
  }
  return parsed;
};

export const runGenerate = async (prompt: string, options: GenerateOptions): Promise<CommandResult> => {
  const model = options.model || defaultTextModel();
  const systemInstruction = await readSystemInstruction(options);
  const schema = options.schema ? await parseSchema(options.schema) : undefined;
  const temperature = parseNumber(options.temperature, "--temperature");
  const maxOutputTokens = parseNumber(options.maxTokens, "--max-tokens");

  const tools: Array<{ type: "google_search" | "url_context" | "code_execution" }> = [
    ...(options.search ? [{ type: "google_search" as const }] : []),
    ...(options.urlContext ? [{ type: "url_context" as const }] : []),
    ...(options.codeExecution ? [{ type: "code_execution" as const }] : [])
  ];

  const generationConfig: Record<string, number> = {
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxOutputTokens !== undefined ? { max_output_tokens: maxOutputTokens } : {})
  };

  const request: Record<string, unknown> = {
    model,
    ...(systemInstruction ? { system_instruction: systemInstruction } : {}),
    ...(schema
      ? { response_format: { type: "text", mime_type: "application/json", schema } }
      : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(Object.keys(generationConfig).length > 0 ? { generation_config: generationConfig } : {})
  };

  if (options.dryRun) {
    return {
      ok: true,
      capability: "generate",
      model,
      message: "dry run",
      details: {
        apiSurface: "interactions",
        request,
        inputFiles: options.file ?? [],
        out: options.out
      }
    };
  }

  const input =
    options.file && options.file.length > 0
      ? [...(await Promise.all(options.file.map(inputPartForFile))), { type: "text", text: prompt }]
      : prompt;

  const ai = createGenAIClient();
  const interaction = (await ai.interactions.create({ ...request, input } as never)) as {
    output_text?: string;
  };

  const text = interaction.output_text?.trim();
  if (!text) {
    throw new Error(`Text model ${model} did not return output_text.`);
  }

  if (schema) {
    try {
      JSON.parse(text);
    } catch {
      throw new Error(`Model output did not parse as JSON despite --schema. Raw output:\n${text}`);
    }
  }

  const outputs = [];
  if (options.out) {
    const path = resolve(options.out);
    await ensureParentDir(path);
    await writeFile(path, `${text}\n`, "utf8");
    outputs.push({ path, mimeType: schema ? "application/json" : "text/plain" });
  }

  return {
    ok: true,
    capability: "generate",
    model,
    stdout: text,
    ...(outputs.length > 0 ? { outputs } : {}),
    details: {
      structured: Boolean(schema),
      tools,
      characters: text.length
    }
  };
};
