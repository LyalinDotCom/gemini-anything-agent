# Gemini Anything Agent

Unofficial proof-of-concept showing one Gemini Managed Agent as a persistent content-generation container.

The user chats with one app. The managed agent handles code, tasks, analysis, research, browsing, and normal file work. When a specialized media capability is needed, the agent calls the [`@lyalindotcom/gai`](https://www.npmjs.com/package/@lyalindotcom/gai) CLI for image, video, TTS, or audio transcription.

Optional richer overview: open [readme.html](readme.html) locally for a standalone HTML version with embedded styling, app icon, and architecture diagram.

## Important Warnings

- Unofficial sample. Not a Google product.
- Unsupported. No warranty. Use at your own risk.
- Not production-ready.
- This repo does not accept contributions.
- Requires a user-provided Gemini API key.
- The key is stored in plaintext `.env` files.
- The app copies the key into the remote managed-agent sandbox as plaintext `.env` content.
- Media generation, video, transcription, search, code execution, retries, and loops can cost real money.
- Use restricted keys, quotas, billing alerts, and throwaway test projects.
- Do not commit real keys.

## Quick Start

Prerequisites:

- Node.js 22+
- npm
- A Gemini API key

Create the root `.env`:

```bash
cp .env.example .env
```

Edit `.env` and add your key:

```bash
GEMINI_API_KEY=your_key_here
GEMINI_ANYTHING_AGENT_ID=gemini-anything-agent
GEMINI_ANYTHING_NPM_PACKAGE=@lyalindotcom/gai
GEMINI_ANYTHING_NPM_VERSION=latest
GEMINI_ANYTHING_TRANSCRIBE_MODEL=gemini-3.5-flash
```

Run the app:

```bash
cd app
npm install
npm run dev
```

Then type a prompt in the app. The first run deploys or refreshes the managed agent automatically.

## What Happens When The App Runs

1. The Electron main process loads the repo-root `.env`.
2. The app checks whether `GEMINI_API_KEY` is present.
3. On first chat run, the app creates or refreshes `GEMINI_ANYTHING_AGENT_ID`.
4. The agent definition mounts files from `agents/` into the remote sandbox.
5. The app also mounts a generated plaintext `.env` source into the sandbox.
6. In the sandbox, `/.agents/bin/gai` sources that `.env` before running the npm CLI.
7. The app sends the prompt to the managed agent.
8. Follow-up turns reuse `previous_interaction_id` for conversation context.
9. Follow-up turns reuse `environment_id` so remote files stay available.
10. Durable remote artifacts are saved under `/workspace/output`.
11. The app downloads generated media locally under `outputs/managed-agent/`.

## Key Handling

The key must come from the user. This sample does not include a key.

For local development, you put `GEMINI_API_KEY` in the repo-root `.env`. The Electron main process reads it and uses it for Managed Agents API calls.

When the app deploys the managed agent, it also builds sandbox `.env` content:

```text
GEMINI_API_KEY=<your key>
GEMINI_ANYTHING_NPM_PACKAGE=@lyalindotcom/gai
GEMINI_ANYTHING_NPM_VERSION=latest
GEMINI_ANYTHING_TRANSCRIBE_MODEL=gemini-3.5-flash
```

That content is mounted into the remote sandbox so `/.agents/bin/gai` can call the GenAI SDK.

This is convenient for the proof of concept, but it is not secure secret management. Treat local `.env`, generated sandbox `.env`, logs, and snapshots as sensitive.

## Components

### App

Path: `app/`

- Electron chat UI.
- One selected managed agent.
- Local conversation list.
- New chats appear in the sidebar as `New chat`.
- Reuses conversation and sandbox continuity by default.
- Downloads and previews image, video, and audio outputs.

### Managed Agent

Path: `agents/`

Mounted into the remote sandbox:

- `agents/system-prompt.md`
- `agents/AGENTS.md`
- `agents/skills/gemini-anything/SKILL.md`
- `agents/bin/gai`
- generated `.env`

The managed agent is the action brain. It should handle:

- code
- tasks
- analysis
- research
- browsing
- normal file work
- deciding when to generate media

### CLI

Path: `cli/`

Published package: [`@lyalindotcom/gai`](https://www.npmjs.com/package/@lyalindotcom/gai)

Commands:

```bash
npx -y @lyalindotcom/gai@latest --help
npx -y @lyalindotcom/gai@latest image --help
npx -y @lyalindotcom/gai@latest video --help
npx -y @lyalindotcom/gai@latest tts --help
npx -y @lyalindotcom/gai@latest transcribe --help
```

Inside the managed-agent sandbox, the agent should call the hard path:

```bash
export GAI="/.agents/bin/gai"
bash "$GAI" --help
```

The wrapper runs:

```bash
npx -y @lyalindotcom/gai@latest ...
```

## Routing Rules

Use managed-agent native tools for:

- text answers
- code
- tasks
- analysis
- research
- browsing
- file inspection and edits
- converting or transforming existing files

Use `gai` for:

- new image generation or image edits
- new video generation
- TTS, narration, podcasts, and voiceover
- audio transcription, captions, timestamps, and speaker labels

For references like “this file,” “the podcast,” or “the previous video,” the agent should inspect `/workspace/output` first.

## Example Prompts

```text
Summarize this project and suggest the next three engineering tasks.
```

```text
Make me a square app icon for a CLI that generates anything.
```

```text
Look at Hacker News and create a short recap podcast.
```

```text
Convert that WAV podcast to MP3.
```

```text
Transcribe the latest podcast with timestamps and speaker labels.
```

## Development

App:

```bash
cd app
npm install
npm run dev
npm test
npm run build
```

CLI:

```bash
cd cli
npm install
npm test
npm run build
npm run gai -- models
```

## Repository Layout

```text
app/                         Electron chat harness
agents/                      Managed-agent prompt, skill, and mounted wrapper
agents/bin/gai               Sandbox wrapper that runs the npm CLI
agents/skills/gemini-anything/SKILL.md
cli/                         @lyalindotcom/gai package source
outputs/                     Local downloaded artifacts, ignored by git
readme.html                  Optional rich standalone overview
```

## Before Reusing This Idea

Add guardrails for:

- spend limits
- quota alerts
- restricted API keys
- real secret storage
- media generation limits
- video confirmation
- timeouts and cancellation
- file size limits
- content policy checks
- audit logs that do not expose secrets
- clear remote-vs-local file handling
