# Gemini Anything Agent App

Electron test harness for one preconfigured Gemini Managed Agent.

The managed agent uses the live npm package [`@lyalindotcom/gai`](https://www.npmjs.com/package/@lyalindotcom/gai) for specialized image, video, TTS, and transcription calls.

The app is intentionally chat-first:

- Every conversation targets `GEMINI_ANYTHING_AGENT_ID`.
- Stored interaction history is on by default.
- The latest `previous_interaction_id` and `environment_id` are reused by default.
- Settings only manage local runtime configuration, not agent creation.

## Setup

```bash
npm install
cp .env.example .env
```

The app also reads the repo-root `.env`, so the root `GEMINI_API_KEY` works during local development.

For this proof of concept, the app also injects that key into the managed agent by mounting a plaintext `.env` file into the remote sandbox. The `/.agents/bin/gai` wrapper sources that file before running the npm package. This is convenient for a sample, but it is not encrypted secret management; use throwaway or restricted keys with quotas, and never commit real keys.

## Run

```bash
npm run dev
```

The web renderer can be previewed with `npm run dev:web`, but live API calls require Electron because the API key stays in the main process.
