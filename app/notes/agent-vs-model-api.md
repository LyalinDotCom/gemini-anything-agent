# Agent vs Model Interactions API

This note captures the observed difference between Gemini Interactions API calls that target a saved/base agent and calls that target a model directly.

## Two Interaction Targets

### Managed agent target

Managed agents are created with a `base_agent`, then invoked by `agent` id.

```json
{
  "agent": "my-first-agent",
  "environment": "remote",
  "store": true,
  "input": "Inspect the workspace."
}
```

Agents created from:

```json
{
  "id": "my-first-agent",
  "base_agent": "antigravity-preview-05-2026"
}
```

Important distinction: `antigravity-preview-05-2026` is a base agent, not a model id.

### Model target

Some Interactions API capabilities are invoked directly with a `model`.

```json
{
  "model": "gemini-3-flash-preview",
  "input": "Open https://example.com in the browser.",
  "tools": [
    {
      "type": "computer_use",
      "environment": "browser"
    }
  ]
}
```

## Computer Use Test Result

A throwaway live probe confirmed:

- `model: "gemini-3-flash-preview"` with `tools: [{ "type": "computer_use", "environment": "browser" }]` works.
- The model returned `requires_action` with browser action `function_call` steps:
  - `open_web_browser`
  - `navigate` to `https://example.com`
- A temporary Playwright/Chrome loop executed the actions and continued with `function_result` screenshots.
- The interaction completed with the page heading: `Example Domain`.

The same `computer_use` tool was rejected for agent-targeted calls:

```text
Tool 'computer_use' is not allowed when interacting with this agent
```

That rejection occurred for both:

- `agent: "antigravity-preview-05-2026"`
- `agent: "my-first-agent"`

## Product Implication

Computer Use should not be represented as a normal managed-agent tool checkbox in the current app.

It needs a separate model-interaction mode that supports:

- `model` instead of `agent`
- `computer_use` tool config
- Browser runtime selection, such as local Playwright or Browserbase
- Screenshot capture
- `function_call` execution
- `function_result` continuation with `previous_interaction_id`
- Safety confirmation handling for `safety_decision.require_confirmation`

Managed-agent runs should continue to use the agent-oriented payload shape and the supported managed-agent tools.
