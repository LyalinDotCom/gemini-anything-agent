# Gemini Anything Agent App

Electron chat harness for one preconfigured Gemini Managed Agent.

Live media abilities use [`@lyalindotcom/gai`](https://www.npmjs.com/package/@lyalindotcom/gai).

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
- Sends all chats to `GEMINI_ANYTHING_AGENT_ID`.
- Reuses `previous_interaction_id` and `environment_id` by default.
- Downloads generated media into `outputs/managed-agent/`.

## Key Warning

This is proof-of-concept key handling.

- Local `.env` is plaintext.
- The sandbox `.env` is plaintext.
- `/.agents/bin/gai` sources the sandbox `.env`.
- Use restricted or throwaway keys.
- Set quotas and billing alerts.
- Never commit real keys.

## Notes

- `npm run dev:web` only previews the renderer.
- Live API calls require Electron because the key stays in the main process.
