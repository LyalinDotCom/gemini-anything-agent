import { GoogleGenAI } from "@google/genai";
import { requireApiKey } from "./config.js";

export const createGenAIClient = (): GoogleGenAI =>
  new GoogleGenAI({
    apiKey: requireApiKey()
  });

