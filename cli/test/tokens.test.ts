import { beforeEach, describe, expect, it, vi } from "vitest";
import { runTokens } from "../src/subcommands/tokens.js";

const genai = vi.hoisted(() => ({
  countTokens: vi.fn()
}));

vi.mock("../src/genaiClient.js", () => ({
  createGenAIClient: () => ({
    models: {
      countTokens: genai.countTokens
    }
  })
}));

describe("tokens command", () => {
  beforeEach(() => {
    genai.countTokens.mockReset();
  });

  it("prints the token count as stdout", async () => {
    genai.countTokens.mockResolvedValueOnce({ totalTokens: 42 });

    const result = await runTokens("some prompt", {});

    expect(result.ok).toBe(true);
    expect(result.capability).toBe("tokens");
    expect(result.stdout).toBe("42");
    expect(result.details).toMatchObject({ totalTokens: 42 });
    expect(genai.countTokens).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-3.5-pro", contents: "some prompt" })
    );
  });

  it("rejects missing input with a usage error", async () => {
    await expect(runTokens(undefined, {})).rejects.toThrow(/Provide text to count/);
    expect(genai.countTokens).not.toHaveBeenCalled();
  });
});
