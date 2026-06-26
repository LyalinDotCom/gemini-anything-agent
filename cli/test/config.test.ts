import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const tmpRoot = join(tmpdir(), "gai-test-env");

beforeEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
});

describe("environment loading", () => {
  it("loads .env from parent directories without printing secrets", async () => {
    mkdirSync(join(tmpRoot, "child"), { recursive: true });
    writeFileSync(join(tmpRoot, ".env"), "GEMINI_API_KEY=test-key\n", "utf8");
    const unique = `../src/config.ts?case=${Date.now()}`;
    const { loadEnvironment } = (await import(unique)) as typeof import("../src/config.js");

    const loaded = loadEnvironment(join(tmpRoot, "child"));
    expect(loaded.some((file) => file.endsWith(".env"))).toBe(true);
    expect(process.env.GEMINI_API_KEY).toBe("test-key");
  });

  it("lets mounted .env values replace placeholder sandbox API keys", async () => {
    mkdirSync(join(tmpRoot, "child"), { recursive: true });
    writeFileSync(join(tmpRoot, ".env"), "GEMINI_API_KEY=real-key\n", "utf8");
    process.env.GEMINI_API_KEY = "PLACEHOLDER";
    const unique = `../src/config.ts?case=${Date.now()}-placeholder`;
    const { getApiKey, loadEnvironment } = (await import(unique)) as typeof import("../src/config.js");

    loadEnvironment(join(tmpRoot, "child"));
    expect(getApiKey()).toBe("real-key");
  });

  it("prefers GOOGLE_API_KEY when both real key env vars are present", async () => {
    process.env.GEMINI_API_KEY = "gemini-key";
    process.env.GOOGLE_API_KEY = "google-key";
    const unique = `../src/config.ts?case=${Date.now()}-google`;
    const { getApiKey } = (await import(unique)) as typeof import("../src/config.js");

    expect(getApiKey()).toBe("google-key");
  });
});
