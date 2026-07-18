# Gemini Anything Agent App

Electron chat harness for selectable Gemini Managed Agent profiles.

Live media abilities use [`@lyalindotcom/gai`](https://www.npmjs.com/package/@lyalindotcom/gai), and real browser testing uses the open-source Playwright agent CLI in the hosted Linux sandbox.

## Setup

Use the repo-root `.env`:

```bash
cp ../.env.example ../.env
```

Add your key:

```bash
GEMINI_API_KEY=your_key_here
```

Run:

```bash
npm install
npm run dev
```

## What The App Does

- Reads the repo-root `.env`.
- Requires `GEMINI_API_KEY`.
- Deploys or refreshes the managed agent on first chat run.
- Mounts `agents/` files into the remote sandbox.
- Copies the key into a generated plaintext sandbox `.env`.
- Defaults new chats to plain Antigravity; the agent card picker also offers the enhanced Anything profile (`GEMINI_ANYTHING_AGENT_ID`), Browser (`GEMINI_BROWSER_AGENT_ID`), and Deep Research profiles.
- Reuses `previous_interaction_id` and `environment_id` by default.
- Downloads generated media into `outputs/managed-agent/`.
- Runs JavaScript websites in a headless browser and downloads requested screenshots, PDFs, traces, videos, and reports from `/workspace/output/browser/`.
- Makes every example card select both its prompt and required agent; the two Browser examples select the dedicated Browser profile automatically.

## Key Warning

- Local `.env` is plaintext.
- The sandbox `.env` is plaintext.
- `/.agents/bin/gai` sources the sandbox `.env`.
- `/.agents/bin/browser` launches Playwright headlessly and does not read the Gemini key.

## Notes

- `npm run dev:web` only previews the renderer.
- Live API calls require Electron because the key stays in the main process.
