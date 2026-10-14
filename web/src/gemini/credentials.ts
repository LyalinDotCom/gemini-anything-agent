import type { Credentials } from "@google/genai";
import { ai } from "./client";
import { toFriendly } from "./errors";
import { redactCredentialError } from "../../../shared/credentialSecrets";

function mutationError(error: unknown, params: object) {
  const friendly = toFriendly(error);
  friendly.message = redactCredentialError(friendly.message, params);
  return friendly;
}

// For a personal BYOK client. A shared web app should perform these operations
// in its authenticated backend; never bundle an OAuth client secret into Vite.
export async function createCredential(params: Credentials.CredentialCreateParams): Promise<Credentials.Credential> {
  try { return await ai().credentials.create(params, { maxRetries: 0 }); }
  catch (error) { throw mutationError(error, params); }
}

export async function getCredential(id: string): Promise<Credentials.Credential> {
  try { return await ai().credentials.get(id, undefined, { maxRetries: 3 }); }
  catch (error) { throw toFriendly(error); }
}

export async function updateCredential(id: string, params: Credentials.CredentialUpdate): Promise<Credentials.Credential> {
  try { return await ai().credentials.update(id, params, { maxRetries: 0 }); }
  catch (error) { throw mutationError(error, params); }
}

export async function deleteCredential(id: string): Promise<void> {
  try { await ai().credentials.delete(id); }
  catch (error) { throw toFriendly(error); }
}
