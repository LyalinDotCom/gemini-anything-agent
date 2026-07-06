// Minimal promise-based IndexedDB wrapper. Transcripts are one record per session;
// media blobs live separately (referenced by mediaId) so localStorage stays tiny
// (Spark's 5MB lesson). Falls back to in-memory maps when IDB is unavailable
// (private mode) — the app keeps working for the current page lifetime.
const DB_NAME = "aichat";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;

const memory = {
  messages: new Map<string, unknown>(),
  media: new Map<string, unknown>(),
};

function openOnce(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("messages")) {
          db.createObjectStore("messages", { keyPath: "sessionId" });
        }
        if (!db.objectStoreNames.contains("media")) {
          const media = db.createObjectStore("media", { keyPath: "id" });
          media.createIndex("by-session", "sessionId");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    // Retry once: a transient open failure (iOS standalone is prone to these) would
    // otherwise silently route every transcript into the volatile memory fallback.
    const first = await openOnce();
    if (first) return first;
    await new Promise((r) => setTimeout(r, 300));
    return openOnce();
  })();
  // Ask the browser not to evict us (Safari ITP); best-effort.
  try {
    void navigator.storage?.persist?.();
  } catch {
    // ignore
  }
  return dbPromise;
}

type StoreName = "messages" | "media";

export async function idbPut(store: StoreName, value: Record<string, unknown>): Promise<void> {
  const db = await openDb();
  if (!db) {
    const key = String(value[store === "messages" ? "sessionId" : "id"]);
    memory[store].set(key, value);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return (memory[store].get(key) as T) ?? null;
  return new Promise((resolve) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory[store].delete(key);
    return;
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** Delete all media rows for a session via the by-session index. */
export async function idbDeleteMediaForSession(sessionId: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    for (const [k, v] of memory.media) {
      if ((v as { sessionId?: string }).sessionId === sessionId) memory.media.delete(k);
    }
    return;
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction("media", "readwrite");
    const idx = tx.objectStore("media").index("by-session");
    const req = idx.openCursor(IDBKeyRange.only(sessionId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** Wipe everything (Settings danger zone). */
export async function idbWipe(): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory.messages.clear();
    memory.media.clear();
    return;
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(["messages", "media"], "readwrite");
    tx.objectStore("messages").clear();
    tx.objectStore("media").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
