// Browser-local API key storage. Ported from Spark-Project src/gemini/keyStore.ts:
// localStorage + change listeners + cross-tab sync; permissive if storage is unavailable.
const STORAGE_KEY = "gaa.geminiApiKey.v1";

const listeners = new Set<() => void>();
let pageKey: string | null = null;

function emit(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // listener errors must never break the store
    }
  }
}

export function getStoredKey(): string | null {
  if (pageKey !== null) return pageKey || null;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return pageKey;
  }
}

export function hasStoredKey(): boolean {
  return getStoredKey() !== null;
}

export function setStoredKey(key: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, key.trim());
    pageKey = null;
  } catch {
    // Storage may be unavailable (private mode); retain it only for this page.
    pageKey = key.trim() || null;
  }
  emit();
}

export function clearStoredKey(): void {
  pageKey = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    pageKey = "";
  }
  emit();
}

/** Subscribe to key changes (returns unsubscribe). Fires on cross-tab changes too. */
export function onKeyChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY || e.key === null) { pageKey = null; emit(); }
  });
}
