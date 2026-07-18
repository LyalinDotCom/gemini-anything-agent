import "dotenv/config";

// Node 25 exposes a warning-only localStorage stub unless a backing path is
// provided. Tests need only the browser contract, so use a deterministic memory store.
const localValues = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    get length() { return localValues.size; },
    clear: () => localValues.clear(),
    getItem: (key: string) => localValues.get(key) ?? null,
    key: (index: number) => [...localValues.keys()][index] ?? null,
    removeItem: (key: string) => void localValues.delete(key),
    setItem: (key: string, value: string) => void localValues.set(key, value),
  } satisfies Storage,
});
