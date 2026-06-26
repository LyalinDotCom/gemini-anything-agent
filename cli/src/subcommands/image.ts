import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { lookup as lookupMime } from "mime-types";
import { createGenAIClient } from "../genaiClient.js";
import { defaultImageModel } from "../models.js";
import { extForMime, resolveOutputPath, writeBase64File } from "../output.js";
import type { CommandResult } from "../types.js";

type ImageOptions = {
  out?: string;
  aspect?: string;
  imageSize?: string;
  mime?: string;
  model?: string;
  file?: string[];
  json?: boolean;
  dryRun?: boolean;
};

const imageInputPart = async (path: string): Promise<Record<string, string>> => {
  const data = await readFile(path);
  const mimeType = lookupMime(path) || "application/octet-stream";
  return {
    type: "image",
    data: data.toString("base64"),
    mime_type: mimeType
  };
};

export const runImage = async (prompt: string, options: ImageOptions): Promise<CommandResult> => {
  const model = options.model || defaultImageModel();
  const mimeType = options.mime || "image/jpeg";
  const outputPath = resolveOutputPath(options.out, "image", extForMime(mimeType, ".png"));

  if (options.dryRun) {
    return {
      ok: true,
      capability: "image",
      model,
      outputs: [{ path: outputPath, mimeType }],
      message: "dry run",
      details: {
        apiSurface: "interactions",
        aspect: options.aspect || "1:1",
        imageSize: options.imageSize || "1K",
        referenceFiles: options.file ?? []
      }
    };
  }

  const ai = createGenAIClient();
  const input =
    options.file && options.file.length > 0
      ? [
          ...(await Promise.all(options.file.map(imageInputPart))),
          {
            type: "text",
            text: prompt
          }
        ]
      : prompt;

  const interaction = (await ai.interactions.create({
    model,
    input,
    response_format: {
      type: "image",
      mime_type: mimeType,
      aspect_ratio: options.aspect || "1:1",
      image_size: options.imageSize || "1K"
    }
  } as never)) as {
    output_text?: string;
    output_image?: { data?: string; mime_type?: string };
  };

  const image = interaction.output_image;
  if (!image?.data) {
    throw new Error(`Image model ${model} did not return output_image.data.`);
  }

  const returnedMime = image.mime_type || mimeType;
  await writeBase64File(outputPath, image.data);

  return {
    ok: true,
    capability: "image",
    model,
    outputs: [{ path: outputPath, mimeType: returnedMime }],
    message: interaction.output_text
  };
};
