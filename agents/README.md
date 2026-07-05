# Agent assets — the deployed agent as a folder of files

Everything the app loads into the deployed managed agent lives in this folder
as plain files. Edit them directly to tune the agent; there are no copies of
this content anywhere in the code.

| File | Where it goes |
| --- | --- |
| `AGENTS.md` | Mounted at `/.agents/AGENTS.md` — the durable instruction layer: extended abilities, routing rules, artifact conventions, response style. |
| `skills/gemini-anything/SKILL.md` | Mounted at `/.agents/skills/gemini-anything/SKILL.md` — detailed gai usage and guardrails. |
| `bin/gai` | Mounted at `/.agents/bin/gai` — the media CLI wrapper the skill invokes. |

## Why there is no system prompt file

The base Antigravity agent's built-in prompt is always present and append-only
— nothing a caller sends can remove it. A request-level `system_instruction`
silently **replaces** an agent-level one, so an agent-level prompt is a
footgun: any caller that injects per-request context would knock it out.
AGENTS.md has neither problem — it stacks with everything and nothing can
displace it — so all durable instructions live there. The app injects only a
small per-request "invocation context" block (current date/time, sandbox
paths, continuity notes), which is the one thing that must be fresh per call.

The sandbox `/.env` is **not** a file here: it is generated at deploy time from
the host `.env` (`GEMINI_API_KEY`, npm package/version, model overrides). API
keys are redacted from config hashes and from anything shown in the UI.

## How changes take effect

The app embeds a hash of the full (secret-redacted) agent definition — these
file contents included — in the agent's description. On the next run it
compares hashes and recreates the agent automatically when anything here
changed. No manual redeploy step; just edit and send a message.

Missing files are a hard error, not a fallback: if the app can't read one of
these files it refuses to deploy, so what you see in this folder is always
exactly what the agent runs with.
