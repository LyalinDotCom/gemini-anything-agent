// GoogleGenAI singleton bound to the user's stored key (Spark client.ts pattern),
// plus the browser CORS shim (verified live): the SDK web build always sends
// an `Api-Revision` header, and that header alone fails the CORS preflight on
// /interactions and /agents. The API works without it, so we delete it in transit.
import { GoogleGenAI } from "@google/genai";
import { FriendlyError, toFriendly } from "./errors";
import { getStoredKey, onKeyChange } from "./keyStore";

// Scope the CORS workaround to SDK requests; never mutate window.fetch.
export const browserApiFetch: typeof fetch = (input, init) => {
  const address = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let origin = "";
  try { origin = new URL(address, typeof location === "undefined" ? undefined : location.href).origin; } catch { /* let fetch handle an unsupported address */ }
  if (origin === "https://generativelanguage.googleapis.com") {
    const clean = (headers?: HeadersInit) => { const value = new Headers(headers); value.delete("api-revision"); return value; };
    if (input instanceof Request) input = new Request(input, { headers: clean(input.headers) });
    if (init?.headers) init = { ...init, headers: clean(init.headers) };
  }
  return globalThis.fetch(input, init);
};

/** The key the app is currently operating with (stored key, else dev/test fallbacks). */
export function resolveApiKey(): string | null {
  return resolveKey();
}

function resolveKey(): string | null {
  const stored = getStoredKey();
  if (stored) return stored;
  // Dev/test fallbacks only; production users always come through the KeyGate.
  const viteKey =
    typeof import.meta !== "undefined" ? (import.meta.env?.VITE_GEMINI_API_KEY as string | undefined) : undefined;
  if ((import.meta.env?.DEV || import.meta.env?.MODE === "test") && viteKey) return viteKey;
  if (typeof window === "undefined" && typeof process !== "undefined" && process.env?.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  return null;
}

let cached: GoogleGenAI | null = null;
let cachedKey = "";

/** The shared client for the current key. Throws FriendlyError("no-key") when unset. */
export function ai(): GoogleGenAI {
  const key = resolveKey();
  if (!key) throw new FriendlyError("no-key", "No Gemini API key set.");
  if (cached && cachedKey === key) return cached;
  // Never silently replay agent or credential creation after an uncertain POST.
  cached = new GoogleGenAI({ apiKey: key, httpOptions: { fetch: browserApiFetch, retryOptions: { attempts: 1 } } });
  cachedKey = key;
  return cached;
}

onKeyChange(() => {
  cached = null;
  cachedKey = "";
});

/** Live probe used by the KeyGate before accepting a key. Deliberately hits the
 *  AGENTS surface — this app never touches the models API family, even for pings. */
export async function validateKey(key: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const probe = new GoogleGenAI({ apiKey: key.trim(), httpOptions: { fetch: browserApiFetch, retryOptions: { attempts: 1 } } });
    await probe.agents.list();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: toFriendly(e).message };
  }
}
