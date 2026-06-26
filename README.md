# Gemini Anything Agent

Gemini Anything is an app-first managed-agent experience backed by one preconfigured Antigravity managed agent. The agent handles normal text, coding, planning, browsing, file work, and multi-step tasks directly.

The `gai` CLI is a small npm-publishable helper that the managed agent can call from its sandbox for specialized media generation:

- `gai image`
- `gai video`
- `gai tts`

See [plan.md](./plan.md) for the current MVP plan.

## App Harness

```bash
cd app
npm install
npm run dev
```

The app reads the repo-root `.env` during local development and sends every chat turn to `GEMINI_ANYTHING_AGENT_ID`.

## CLI Development

```bash
cd cli
npm install
npm test
npm run build
npm run gai -- models
```

Live media calls require `GEMINI_API_KEY` in the root `.env` or environment.
