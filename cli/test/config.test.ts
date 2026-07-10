import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const tmpRoot = join(tmpdir(), "gai-test-env");

beforeEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  process.env.GEMINI_ANYTHING_CONFIG_DIR = join(tmpRoot, "config");
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_ANYTHING_CONFIG_DIR;
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

  it("loads the persistent user key outside any project directory", async () => {
    mkdirSync(join(tmpRoot, "config"), { recursive: true });
    mkdirSync(join(tmpRoot, "unrelated"), { recursive: true });
    writeFileSync(join(tmpRoot, "config", ".env"), "GEMINI_API_KEY=global-key\n", "utf8");
    const unique = `../src/config.ts?case=${Date.now()}-global`;
    const { getApiKey, loadEnvironment } = (await import(unique)) as typeof import("../src/config.js");

    loadEnvironment(join(tmpRoot, "unrelated"));
    expect(getApiKey()).toBe("global-key");
  });

  it("keeps project .env keys ahead of the persistent user key", async () => {
    mkdirSync(join(tmpRoot, "config"), { recursive: true });
    mkdirSync(join(tmpRoot, "project", "child"), { recursive: true });
    writeFileSync(join(tmpRoot, "config", ".env"), "GEMINI_API_KEY=global-key\n", "utf8");
    writeFileSync(join(tmpRoot, "project", ".env"), "GEMINI_API_KEY=project-key\n", "utf8");
    const unique = `../src/config.ts?case=${Date.now()}-precedence`;
    const { getApiKey, loadEnvironment } = (await import(unique)) as typeof import("../src/config.js");

    loadEnvironment(join(tmpRoot, "project", "child"));
    expect(getApiKey()).toBe("project-key");
  });

  it("falls back to the persistent key when a project contains a placeholder", async () => {
    mkdirSync(join(tmpRoot, "config"), { recursive: true });
    mkdirSync(join(tmpRoot, "project", "child"), { recursive: true });
    writeFileSync(join(tmpRoot, "config", ".env"), "GEMINI_API_KEY=global-key\n", "utf8");
    writeFileSync(join(tmpRoot, "project", ".env"), "GEMINI_API_KEY=PLACEHOLDER\n", "utf8");
    const unique = `../src/config.ts?case=${Date.now()}-placeholder-fallback`;
    const { getApiKey, loadEnvironment } = (await import(unique)) as typeof import("../src/config.js");

    loadEnvironment(join(tmpRoot, "project", "child"));
    expect(getApiKey()).toBe("global-key");
  });

  it("persists the user key with user-only file permissions", async () => {
    const unique = `../src/config.ts?case=${Date.now()}-persist`;
    const { persistUserApiKey, readUserApiKey, userEnvPath } = (await import(unique)) as typeof import("../src/config.js");

    const path = persistUserApiKey("persistent-key");
    expect(path).toBe(userEnvPath());
    expect(readUserApiKey()).toBe("persistent-key");
    expect(readFileSync(path, "utf8")).toBe("GEMINI_API_KEY=persistent-key\n");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
