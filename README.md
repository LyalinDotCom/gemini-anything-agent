# Gemini Anything Agent

An unofficial, open-source sample app for the [Gemini Managed Agents API](https://ai.google.dev/gemini-api/docs/agents): one desktop chat app, one persistent cloud agent that can code, research, browse, work with files — and generate images, video, music, and speech.

![Gemini Anything Agent — new chat with the example gallery, conversation sidebar, and output drawer](docs/images/app-screenshot.png)

The user talks to one app. The app talks to one managed agent running in a Google-hosted Linux sandbox. The agent does normal work with its native tools and calls [`@lyalindotcom/gai`](https://www.npmjs.com/package/@lyalindotcom/gai) only for media generation.

## Top Features

- **One persistent agent workspace.** Chat turns chain server-side (`previous_interaction_id`) and reuse the same sandbox filesystem (`environment_id`), so the agent can build on earlier work and artifacts.
- **Agent switcher.** Run the default **Antigravity**-based custom agent, or flip the composer selector to **Deep Research** / **Deep Research Max** for long-form autonomous research reports.
- **Media generation.** Image, video, music (Lyria), text-to-speech, and audio transcription via the bundled `gai` CLI mounted into the sandbox.
- **Live activity timeline.** Streamed agent steps render as a clean timeline — thinking, commands, file writes, tool calls — with the raw event stream one tab away.
- **Output drawer with real previews.** Everything the agent saves to `/workspace/output` shows up in the right-hand panel: inline image/video/audio players, a sandboxed HTML preview (multi-page HTML apps navigate inline), and a document-grade Markdown/text viewer.
- **Disconnect-proof runs.** Runs execute in the background on Google's side; the app streams live, auto-reconnects dropped streams with backoff, and resumes runs after a full app restart.
- **Readable local history.** Every conversation persists to `chats/` as browsable folders — `conversation.json`, a human-readable `conversation.md`, and per-turn request/response/event records.
- **Example gallery.** One-click starter prompts for image, video, music, TTS, transcription, multi-step tasks, and single-file web apps.

## Read This First

- This is an unofficial proof of concept. Unsupported; no contributions; use at your own risk.
- You must provide your own Gemini API key.
- The key is read from a local plaintext `.env`, and the app mounts that key into the remote managed-agent sandbox as plaintext `.env` content.
- Live agent and media calls can cost money.

## Getting Started

**Prerequisites:** Node.js 22+, npm, and a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).

**1. Clone and configure.** Create the root `.env`:

```bash
cp .env.example .env
```

Edit `.env` and set your key (the other defaults work as-is):

```bash
GEMINI_API_KEY=your_key_here
GEMINI_ANYTHING_AGENT_ID=gemini-anything-agent
GEMINI_ANYTHING_NPM_PACKAGE=@lyalindotcom/gai
GEMINI_ANYTHING_NPM_VERSION=latest
GEMINI_ANYTHING_MUSIC_MODEL=lyria-3-clip-preview
GEMINI_ANYTHING_TRANSCRIBE_MODEL=gemini-3.5-flash
```

**2. Install and run the app:**

```bash
cd app
npm install
npm run dev
```

**3. Send a prompt.** Pick an example card or type your own. The first run deploys (or refreshes) the managed agent automatically — you'll see an "Agent deployed" status when it's ready.

**4. Watch the output drawer.** Generated files land in `/workspace/output` in the sandbox; the app downloads them, previews them inline, and saves media copies under `outputs/managed-agent/`.

To try **Deep Research**, switch the small agent selector next to Options in the composer. Research runs happen in the background (up to 60 minutes); the app keeps following them and the finished report previews as a document.

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

- Electron chat UI with a conversation sidebar (drag to reorder), live run timeline, and output drawer.
- Inline previews for image, video, audio, HTML, Markdown, and text outputs.
- Background-run recovery: stream reconnect with backoff, resume after restart.
- Chats persist to `chats/` as readable folders.

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

`gai` handles new image generation, video generation, TTS, music generation, and audio transcription.

When the user refers to an existing artifact, the agent should inspect `/workspace/output` first.

## Agent Switch: Deep Research

The composer shows the active agent next to Options; click the small switch icon to change it:

- **Antigravity** (default) — the custom managed agent built on `antigravity-preview-05-2026`.
- **Deep Research** — Google's `deep-research-preview-04-2026` managed agent.
- **Deep Research Max** — `deep-research-max-preview-04-2026`.

Deep Research agents are invoked directly by base-agent id (no custom agent is deployed for them). They always run in the background with stored history — research can take up to 60 minutes, and the app keeps polling until the interaction finishes. Follow-up prompts in the same conversation chain through `previous_interaction_id`, so you can ask for revisions to a finished report. Per-run system-instruction, tool, and environment overrides apply only to the Antigravity agent.

## More Docs

- Rich standalone overview: open [readme.html](readme.html) locally.
- DevRel walk-through: [Building a Managed Agent That Can Generate Media](docs/gemini-anything-agent-image-walkthrough.html) ([Markdown source](docs/gemini-anything-agent-image-walkthrough.md)).

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
chats/         Local conversation history written by the app, ignored by git
docs/          Walk-through and README assets
outputs/       Local downloaded artifacts, ignored by git
readme.html    Optional rich standalone overview
```
