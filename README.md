# Gemini Anything Agent

An unofficial, open-source sample for the [Gemini Managed Agents API](https://ai.google.dev/gemini-api/docs/agents): matching Electron and browser chat apps with selectable persistent cloud-agent profiles that can code, research, operate a real headless browser, work with files — and generate images, video, music, and speech.

![Gemini Anything Agent — new chat with the example gallery, conversation sidebar, and output drawer](docs/images/app-screenshot.png)

## Try the Hosted Web App

[Open the Firebase-hosted demo](https://ai-chatbot-agent-54153.web.app). Bring your own
[Gemini API key](https://aistudio.google.com/apikey); the web app asks for it when you start.

The user talks to one app. Each conversation talks to the selected managed-agent profile running in a Google-hosted Linux sandbox. The agent does normal work with its native tools, uses Playwright for real browser work, and calls [`@lyalindotcom/gai`](https://www.npmjs.com/package/@lyalindotcom/gai) only for media generation.

## Top Features

- **One persistent agent workspace.** Chat turns chain server-side (`previous_interaction_id`) and reuse the same sandbox filesystem (`environment_id`), so the agent can build on earlier work and artifacts.
- **Agent switcher.** Choose the general **Antigravity** profile, dedicated **Browser** testing profile, or **Deep Research** / **Deep Research Max** for long-form autonomous reports.
- **Media generation.** Image, video, music (Lyria), text-to-speech, and audio transcription via the bundled `gai` CLI mounted into the sandbox.
- **Real headless browser automation.** The agent can navigate JavaScript applications, interact through accessibility snapshots, test flows, inspect console/network activity, and save screenshots, PDFs, traces, and videos with Playwright.
- **Live activity timeline.** Streamed agent steps render as a clean timeline — thinking, commands, file writes, tool calls — with the raw event stream one tab away.
- **Output drawer with real previews.** Everything the agent saves to `/workspace/output` shows up in the right-hand panel: inline image/video/audio players, a sandboxed HTML preview (multi-page HTML apps navigate inline), and a document-grade Markdown/text viewer.
- **Disconnect-proof runs.** Runs execute in the background on Google's side; the app streams live, auto-reconnects dropped streams with backoff, and resumes runs after a full app restart.
- **Readable local history.** Every conversation persists to `chats/` as browsable folders — `conversation.json`, a human-readable `conversation.md`, and per-turn request/response/event records.
- **Agent-aware example gallery.** One-click cards select both the prompt and required profile, including interactive flow testing and responsive browser QA.
- **Full browser app.** The Firebase-hosted UI carries the same five profiles, ten examples,
  run controls, recovery, output previews, and snapshot downloads as Electron.
- **Permission-gated local projects.** In desktop Chrome/Edge, a web conversation can link
  a local folder and sync its `/workspace/output` tree directly to disk; snapshot download
  remains the fallback everywhere else.

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
GEMINI_ANYTHING_AGENT_ID=gai-anything-v1
GEMINI_BROWSER_AGENT_ID=gai-browser-v1
GEMINI_ANYTHING_NPM_PACKAGE=@lyalindotcom/gai
GEMINI_ANYTHING_NPM_VERSION=latest
GEMINI_ANYTHING_BROWSER_PACKAGE=@playwright/cli
GEMINI_ANYTHING_BROWSER_VERSION=latest
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

New chats default to plain **Antigravity**. Open the agent card picker next to Options to choose **Anything**, **Browser**, or either **Deep Research** profile; each card explains the agent and shows its model. Research runs happen in the background (up to 60 minutes), while the app keeps following them and previews the finished report as a document.

## What Happens At Runtime

1. Electron loads the repo-root `.env`.
2. The app uses `GEMINI_API_KEY` for Managed Agents API calls.
3. Before a custom-profile chat run, the app creates or refreshes `GEMINI_ANYTHING_AGENT_ID` or `GEMINI_BROWSER_AGENT_ID` as selected.
4. The agent is deployed with files from `agents/`.
5. The app also mounts generated plaintext `.env` content into the remote sandbox.
6. In the sandbox, `/.agents/bin/gai` sources that `.env`.
7. `/.agents/bin/gai` runs `npx -y @lyalindotcom/gai@latest ...`.
8. `/.agents/bin/browser` runs the published `@playwright/cli` headlessly and keeps named browser sessions alive across commands.
9. Follow-up turns reuse `previous_interaction_id` for chat context.
10. Follow-up turns reuse `environment_id` for sandbox files and installed browser binaries.
11. Remote artifacts are written to `/workspace/output`.
12. The app downloads generated media and browser evidence into `outputs/managed-agent/`.

## Components

### App

Path: `app/`

- Electron chat UI with a conversation sidebar (drag to reorder), live run timeline, and output drawer.
- Inline previews for image, video, audio, HTML, Markdown, and text outputs.
- Background-run recovery: stream reconnect with backoff, resume after restart.
- Chats persist to `chats/` as readable folders.

### Web

Path: `web/`

- Static React/Firebase app using the user's browser-stored Gemini key.
- The same Antigravity, Anything, Browser, Deep Research, and Deep Research Max profiles,
  agent-aware sample cards, advanced run options, background recovery, and output previews.
- Conversations, transcripts, media, and permission-granted local folder handles persist
  in localStorage/IndexedDB; large snapshots are filtered incrementally in the browser.

### Managed Agent

Path: `agents/`

Mounted into the remote sandbox:

- `agents/AGENTS.md`
- `agents/skills/gemini-anything/SKILL.md`
- `agents/bin/gai`
- `agents/skills/browser-testing/SKILL.md`
- `agents/bin/browser`
- generated `.env`

This folder is the single source of truth — edit any file and the app
redeploys the agent automatically on the next run (config-hash drift
detection). See `agents/README.md` for the full mapping.

The shared managed-agent payload is the action brain: code, tasks, analysis, research, browser testing, file work, and deciding when media generation is needed. The general and Browser profiles use distinct managed-agent IDs but mount the identical `agents/` files.

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

Native managed-agent tools handle text, code, tasks, analysis, research, simple URL reading, file work, and existing-file transformations.

The Playwright browser launcher handles JavaScript-rendered navigation, interaction, browser testing, screenshots, console/network inspection, storage, tracing, video, and PDF capture.

`gai` handles new image generation, video generation, TTS, music generation, and audio transcription.

When the user refers to an existing artifact, the agent should inspect `/workspace/output` first.

## Agent Switcher

The composer shows the active agent next to Options; click the small switch icon to change it:

- **Antigravity** (default) — the plain `antigravity-preview-05-2026` agent.
- **Anything** — Antigravity plus the shared media and browser payload under `gai-anything-v1`.
- **Browser** — a dedicated custom profile that prioritizes real headless Playwright navigation, interaction, assertions, and saved evidence.
- **Deep Research** — Google's `deep-research-preview-04-2026` managed agent.
- **Deep Research Max** — `deep-research-max-preview-04-2026`.

Deep Research agents are invoked directly by base-agent id (no custom agent is deployed for them). They always run in the background with stored history — research can take up to 60 minutes, and the app keeps polling until the interaction finishes. Follow-up prompts in the same conversation chain through `previous_interaction_id`, so you can ask for revisions to a finished report. Per-run system-instruction, tool, and environment overrides apply to Antigravity, Anything, and Browser profiles.

## More Docs

- Rich standalone overview: open [readme.html](readme.html) locally.
- DevRel walk-through: [Building a Managed Agent That Can Generate Media](docs/gemini-anything-agent-image-walkthrough.html) ([Markdown source](docs/gemini-anything-agent-image-walkthrough.md)).

## Development

App:

```bash
cd app
npm test
npm run build
npm run test:browser:live  # real disposable managed-agent + Linux/Chrome smoke test
```

Web:

```bash
cd web
npm test
npm run build
npm run test:live  # includes a real background Browser profile + artifact verification
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
web/           Browser chat app (static, Firebase-hosted; user-supplied key)
agents/        Managed-agent instructions (AGENTS.md), skill, and wrapper — SHARED by app/ and web/
cli/           @lyalindotcom/gai package source
chats/         Local conversation history written by the app, ignored by git
docs/          Walk-through and README assets
outputs/       Local downloaded artifacts, ignored by git
readme.html    Optional rich standalone overview
```

See [docs/browser-agent-poc.md](docs/browser-agent-poc.md) for the browser-stack comparison, verified VM result, capabilities, and boundaries.

Both UIs deploy the exact same agent payload from `agents/` (the web app bundles the files
via Vite `?raw` imports; the Electron app reads them from disk) — edit once, both agents
update on their next message via the payload fingerprint.
