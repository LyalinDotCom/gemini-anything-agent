import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tmpRoot = join(process.cwd(), ".tmp-test-env");

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.GEMINI_API_KEY;
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
});

