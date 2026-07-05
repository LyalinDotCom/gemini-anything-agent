# Agent assets — the deployed agent as a folder of files

Everything the app loads into the deployed managed agent lives in this folder
as plain files. Edit them directly to tune the agent; there are no copies of
this content anywhere in the code.

| File | Where it goes |
| --- | --- |
| `system-prompt.md` | Agent `system_instruction`, and re-injected on every interaction (with live invocation context appended: date/time, sandbox paths, continuity notes). |
| `system-prompt-plain.md` | Same, but used when specialized tools are disabled (plain native mode). |
| `AGENTS.md` | Mounted in the sandbox at `/.agents/AGENTS.md`. |
| `skills/gemini-anything/SKILL.md` | Mounted at `/.agents/skills/gemini-anything/SKILL.md`. |
| `bin/gai` | Mounted at `/.agents/bin/gai` — the media CLI wrapper the skill invokes. |

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
