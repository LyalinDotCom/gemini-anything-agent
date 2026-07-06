// GoogleGenAI singleton bound to the user's stored key (Spark client.ts pattern),
// plus the browser CORS shim (verified live): the SDK web build always sends
// an `Api-Revision` header, and that header alone fails the CORS preflight on
// /interactions and /agents. The API works without it, so we delete it in transit.
import { GoogleGenAI } from "@google/genai";
import { FriendlyError, toFriendly } from "./errors";
import { getStoredKey, onKeyChange } from "./keyStore";

let shimInstalled = false;

function installCorsShim(): void {
  if (shimInstalled || typeof window === "undefined") return;
  shimInstalled = true;
  const orig = window.fetch.bind(window);
  const strip = (h: HeadersInit | undefined): Headers => {
    const hh = new Headers(h ?? {});
    hh.delete("api-revision");
    return hh;
  };
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("generativelanguage.googleapis.com")) {
      if (input instanceof Request) input = new Request(input, { headers: strip(input.headers) });
      if (init?.headers !== undefined) init = { ...init, headers: strip(init.headers) };
    }
    return orig(input, init);
  };
}

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
  if (viteKey) return viteKey;
  if (typeof process !== "undefined" && process.env?.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  return null;
}

let cached: GoogleGenAI | null = null;
let cachedKey = "";

/** The shared client for the current key. Throws FriendlyError("no-key") when unset. */
export function ai(): GoogleGenAI {
  installCorsShim();
  const key = resolveKey();
  if (!key) throw new FriendlyError("no-key", "No Gemini API key set.");
  if (cached && cachedKey === key) return cached;
  cached = new GoogleGenAI({ apiKey: key });
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
  installCorsShim();
  try {
    const probe = new GoogleGenAI({ apiKey: key.trim() });
    await probe.agents.list();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: toFriendly(e).message };
  }
}
