# Gemini Anything Agent

Unofficial proof-of-concept showing one Gemini Managed Agent as a persistent container for code, tasks, analysis, and generated media.

The user talks to one app. The app talks to one managed agent. The agent does normal work itself and calls [`@lyalindotcom/gai`](https://www.npmjs.com/package/@lyalindotcom/gai) only for image, video, TTS, and audio transcription.

Optional richer overview: open [readme.html](readme.html) locally.

## Read This First

- This is an unofficial proof of concept.
- Unsupported; no contributions; use at your own risk.
- You must provide your own Gemini API key.
- The key is read from a local plaintext `.env`.
- The app mounts that key into the remote managed-agent sandbox as plaintext `.env` content.
- Live agent and media calls can cost money.

## Quick Start

Create the root `.env`:

```bash
cp .env.example .env
```

Edit `.env`:

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

Type a prompt. The first run deploys or refreshes the managed agent.

## What Happens At Runtime

1. Electron loads the repo-root `.env`.
2. The app uses `GEMINI_API_KEY` for Managed Agents API calls.
3. Before the first chat run, the app creates or refreshes `GEMINI_ANYTHING_AGENT_ID`.
4. The agent is deployed with files from `agents/`.
5. The app also mounts generated plaintext `.env` content into the remote sandbox.
6. In the sandbox, `/.agents/bin/gai` sources that `.env`.
7. `/.agents/bin/gai` runs `npx -y @lyalindotcom/gai@latest ...`.
8. Follow-up turns reuse `previous_interaction_id` for chat context.
9. Follow-up turns reuse `environment_id` for sandbox files.
10. Remote artifacts are written to `/workspace/output`.
11. The app downloads generated media into `outputs/managed-agent/`.

## Components

### App

Path: `app/`

- Electron chat UI.
- One managed agent.
- Local conversation list.
- New chats show as `New chat` in the sidebar.
- Inline previews for image, video, and audio.

### Managed Agent

Path: `agents/`

Mounted into the remote sandbox:

- `agents/system-prompt.md`
- `agents/AGENTS.md`
- `agents/skills/gemini-anything/SKILL.md`
- `agents/bin/gai`
- generated `.env`

The managed agent is the action brain: code, tasks, analysis, research, browsing, file work, and deciding when media generation is needed.

### CLI

Path: `cli/`

Published package: [`@lyalindotcom/gai`](https://www.npmjs.com/package/@lyalindotcom/gai)

Local usage:

```bash
npx -y @lyalindotcom/gai@latest --help
```

Managed-agent sandbox usage:

```bash
export GAI="/.agents/bin/gai"
bash "$GAI" --help
```

## Routing

Native managed-agent tools handle text, code, tasks, analysis, research, browsing, file work, and existing-file transformations.

`gai` handles new image generation, video generation, TTS, and audio transcription.

When the user refers to an existing artifact, the agent should inspect `/workspace/output` first.

## Development

App:

```bash
cd app
npm test
npm run build
```

CLI:

```bash
cd cli
npm test
npm run build
```

## Layout

```text
app/           Electron chat harness
agents/        Managed-agent prompt, skill, and wrapper
cli/           @lyalindotcom/gai package source
outputs/       Local downloaded artifacts, ignored by git
readme.html    Optional rich standalone overview
```
