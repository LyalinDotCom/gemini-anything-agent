import { describe, expect, it } from "vitest";
import { agentConfigHash } from "../src/main/agentConfig";
import { ANTIGRAVITY_BASE_AGENT, type AgentDefinition } from "../src/sdk";

const definitionWithKey = (apiKey: string): AgentDefinition => ({
  id: "gemini-anything-v1",
  base_agent: ANTIGRAVITY_BASE_AGENT,
  tools: [{ type: "code_execution" }],
  base_environment: {
    type: "remote",
    sources: [
      {
        type: "inline",
        target: ".env",
        content: `GEMINI_API_KEY=${apiKey}\n`
      }
    ]
  }
});

describe("managed-agent configuration fingerprint", () => {
  it("changes when the sandbox API key rotates", () => {
    expect(agentConfigHash(definitionWithKey("first-key"))).not.toBe(
      agentConfigHash(definitionWithKey("second-key"))
    );
  });

  it("does not recursively include its generated description", () => {
    const definition = definitionWithKey("test-key");
    expect(agentConfigHash({ ...definition, description: "config:anything" })).toBe(
      agentConfigHash(definition)
    );
  });
});
