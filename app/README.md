# Gemini Anything Agent App

Electron test harness for one preconfigured Gemini Managed Agent.

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

## Run

```bash
npm run dev
```

The web renderer can be previewed with `npm run dev:web`, but live API calls require Electron because the API key stays in the main process.
