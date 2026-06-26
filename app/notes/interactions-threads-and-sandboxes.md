# Interactions, Threads, And Sandboxes

This note captures the current mental model for Gemini Interactions API and Managed Agents UI design.

## Core Model

The API is built around `interactions.create`. An interaction is one invocation: configuration plus input plus execution result.

For managed agents, the basic shape is:

```json
{
  "agent": "antigravity-preview-05-2026",
  "input": "Do the task",
  "environment": "remote"
}
```

That call provisions or attaches to an environment, runs the agent loop, and returns an `Interaction` object with ids, steps, usage, output, and an optional `environment_id`.

## Four Concepts To Keep Separate

### Agent Project

The reusable definition of behavior and assets:

- Managed agent id
- `base_agent`
- AGENTS.md instructions
- SKILL.md files
- Project assets and inline sources
- Saved tool/environment defaults

This is not the work itself. It is the reusable agent configuration.

### Turn / Run

One `interactions.create` call.

The prompt/input is a first-class part of the turn. It is not just chat text attached to an agent. The effective payload for a turn includes:

- `agent` or `model`
- `input`
- `environment`
- `previous_interaction_id`
- tools
- system instruction
- generation config
- store/stream behavior

Each turn should keep an immutable snapshot of the request and agent definition used at the time it ran.

### Thread

A sequence of turns linked by `previous_interaction_id`.

This preserves conversation history on the server. It is the chat/conversation dimension.

Important: `previous_interaction_id` preserves conversation inputs and outputs. Interaction-scoped options such as tools, system instruction, and generation config must be sent again when they should apply to a later turn.

### Sandbox

The remote environment filesystem/process state, identified by `environment_id`.

This is separate from conversation memory. Reusing the same `environment_id` preserves files and installed packages. Starting with `environment: "remote"` creates a fresh sandbox.

## UI Implication

The app should not treat a saved agent as a single always-on chat session.

A better model is:

```text
Agent Project
  -> Threads
      -> Turns / Runs
          -> Prompt
          -> Effective config snapshot
          -> Agent actions / steps
          -> Result
          -> Environment id
```

The UI can still present a thread in a familiar chat format, but it should be clear that every message is an API interaction with its own payload and setup.

## Suggested UX Direction

- Use "New task" for a fresh prompt with fresh context.
- Use "Continue thread" when sending `previous_interaction_id`.
- Use "Same sandbox" when sending a previous `environment_id`.
- Make the prompt/input prominent for every turn.
- Show each turn as: user prompt, agent work, assistant result, turn complete marker.
- Keep Setup as an inspectable snapshot for the turn.
- Keep Raw as a separate debug mode, not the primary reading surface.
- Group history by thread rather than only listing individual runs.

## Product Language

Recommended labels:

- "Agent Project" for saved managed agent configuration and files.
- "Thread" for linked interactions.
- "Turn" or "Run" for one `interactions.create` call.
- "Sandbox" for the environment selected by `environment` / `environment_id`.

Avoid implying that editing the agent project mutates historical turns. Historical turns should remain read-only snapshots.
