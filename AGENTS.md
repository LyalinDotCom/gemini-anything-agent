# AGENTS.md — gemini-anything-agent

One repo, one shared agent payload, multiple selectable profiles and UIs:

- `cli/` — source of the published npm CLI **[`@lyalindotcom/gai`](https://www.npmjs.com/package/@lyalindotcom/gai)** (bin: `gai`) — all media capability (image, video, TTS, music, transcription)
- `agents/` — the managed-agent payload (AGENTS.md, media/browser launchers, skills) — **the single source of truth, SHARED by every profile and both UIs**
- `app/` — Electron chat harness (reads `agents/` from disk at deploy time)
- `web/` — static browser chat app, Firebase-hosted, user-supplied key (bundles `agents/` via Vite `?raw` imports)

## Hard rules — do not re-litigate

1. **Media = the published `@lyalindotcom/gai` CLI, run via `npx`.** The sandbox gets a
   one-line launcher (`agents/bin/gai` → `/.agents/bin/gai`) that `exec`s
   `npx -y @lyalindotcom/gai@latest "$@"`. Agent docs tell the agent exactly one thing
   about capabilities: discover them with `bash /.agents/bin/gai --help` (then subcommand
   `--help`). Nothing model- or flag-specific goes into docs — future models/modalities
   arrive through CLI updates, never doc edits. **NEVER** replace or augment this with a
   local reimplementation, Python helper, wrapper library, or hand-rolled REST calls —
   Dmitry has explicitly ordered this after a drift incident (a local `gemini_helper.py`
   was once built in the predecessor repo; it was a mistake and was removed).
2. **`agents/` stays shared.** Both UIs must deploy the identical payload from `agents/`;
   never fork per-UI copies of instructions, skills, or the launcher. The key ships
   separately as `/.env` (`GEMINI_API_KEY=…`) by BOTH UIs so the shared launcher works
   byte-identically.
3. **Never write a bare `gai` command in agent-facing docs** — unscoped `gai` on npm is an
   unrelated third-party package (a GDB tool), and agents have historically npm-resolved
   bare names to it. Always `bash /.agents/bin/gai` in docs and the scoped
   `@lyalindotcom/gai` in code.
4. `npx` works inside the managed-agent sandbox (HTTP proxy egress; launcher sets
   `NODE_USE_ENV_PROXY=1` + npm cache under `/workspace`) — field-tested. Do not
   "optimize" it away on networking grounds.

The `web/` app was migrated from the retired `~/Source/Projects/ai-chatbot-agents` repo
(2026-07-06); that project is archived and must not be resurrected as a separate agent.
