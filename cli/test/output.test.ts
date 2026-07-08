import { afterEach, describe, expect, it, vi } from "vitest";
import { extractPath, printResult } from "../src/output.js";

const captureStdout = (): string[] => {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
    lines.push(String(chunk));
    return true;
  }) as never);
  return lines;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractPath", () => {
  it("walks objects and array indexes", () => {
    const result = {
      ok: true,
      outputs: [{ path: "/tmp/a.png" }],
      details: { file: { name: "files/abc" } }
    };
    expect(extractPath(result, "outputs.0.path")).toBe("/tmp/a.png");
    expect(extractPath(result, "details.file.name")).toBe("files/abc");
    expect(extractPath(result, "details.missing.deep")).toBeUndefined();
  });
});

describe("printResult shaping", () => {
  it("prints transformed values as JSON by default", () => {
    const lines = captureStdout();
    printResult({ details: { count: 3 } }, true, { transform: "details.count" });
    expect(lines.join("")).toBe("3\n");
  });

  it("prints bare strings with --raw", () => {
    const lines = captureStdout();
    printResult({ outputs: [{ path: "/tmp/a.png" }] }, true, {
      transform: "outputs.0.path",
      raw: true
    });
    expect(lines.join("")).toBe("/tmp/a.png\n");
  });

  it("prints the stdout field in plain mode", () => {
    const lines = captureStdout();
    printResult({ ok: true, stdout: "Hello there." }, false);
    expect(lines.join("")).toBe("Hello there.\n");
  });

  it("keeps printing output paths in plain mode", () => {
    const lines = captureStdout();
    printResult({ ok: true, outputs: [{ path: "/tmp/a.png" }, { path: "/tmp/b.png" }] }, false);
    expect(lines.join("")).toBe("/tmp/a.png\n/tmp/b.png\n");
  });
});
