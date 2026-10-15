import { afterEach, expect, test, vi } from "vitest";
import { clearStoredKey, getStoredKey, hasStoredKey, setStoredKey } from "../src/gemini/keyStore";
afterEach(() => { vi.restoreAllMocks(); clearStoredKey(); localStorage.clear(); });
test("a validated key works for the current page when browser storage is blocked", () => {
  vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  vi.spyOn(localStorage, "removeItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  setStoredKey(" test-key ");
  expect(hasStoredKey()).toBe(true);
  expect(getStoredKey()).toBe("test-key");
  clearStoredKey(); expect(hasStoredKey()).toBe(false);
});
test("normal storage clearing never revives a previous page-only key", () => {
  setStoredKey("test-key"); localStorage.clear(); expect(getStoredKey()).toBeNull();
});

test("a quota error uses the replacement key even when the old stored key remains readable",()=>{
 setStoredKey("old-key");vi.spyOn(localStorage,"setItem").mockImplementation(()=>{throw new Error("Quota full");});
 setStoredKey("replacement-key");expect(getStoredKey()).toBe("replacement-key");
});
