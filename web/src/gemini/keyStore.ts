// Browser-local API key storage. Ported from Spark-Project src/gemini/keyStore.ts:
// localStorage + change listeners + cross-tab sync; permissive if storage is unavailable.
const STORAGE_KEY = "aichat.geminiApiKey.v1";

const listeners = new Set<() => void>();

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
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function hasStoredKey(): boolean {
  return getStoredKey() !== null;
}

export function setStoredKey(key: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, key.trim());
  } catch {
    // storage may be unavailable (private mode) — key lives for this page only
  }
  emit();
}

export function clearStoredKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
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
    if (e.key === STORAGE_KEY) emit();
  });
}
