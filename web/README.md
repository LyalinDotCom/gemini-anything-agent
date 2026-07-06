# Gemini Anything — Web

The browser UI for the Gemini Anything managed agent (the Electron UI lives in
[../app/](../app/); both deploy the **same shared agent** from [../agents/](../agents/)).
One idea taken all the way: **every AI interaction runs in a remote, server-side agent
container — the web client is just a static terminal.** You open a static page, paste your
own Gemini key, and chat. Reasoning, code execution, web research, and media generation all
happen inside the session's hosted sandbox; anything the agent produces syncs *down* to
your browser as files.

**Live:** https://ai-chatbot-agent-54153.web.app

- **Answers & writing** — streamed markdown from the managed agent
- **Real code execution** — Python/shell in the agent's container, narrated in the chat
- **Web research** — google_search + url_context server-side, with citations
- **Media, generated IN the container** — the agent runs the published
  [`@lyalindotcom/gai`](https://www.npmjs.com/package/@lyalindotcom/gai) CLI (via `npx`)
  from inside its own sandbox and saves to `/workspace/output/`; capabilities are
  discovered live with `gai --help`, never hardcoded
- **Media sync** — after each turn the client pulls the environment snapshot (tar), imports
  new `/output/` files into IndexedDB, and renders them inline (images/audio/video/files)
- **Container files panel** — browse/play/download anything in the sandbox at any time
- **Deep Research mode** — background research sessions that survive reloads
- **Voice messages** — mic audio goes straight into the chain; the *agent* hears it (no
  client-side transcription)

## Architecture: nothing intelligent happens on the client

```
Browser (static, key in localStorage)
  │  interactions.create({agent, previous_interaction_id, environment})   ← the ONLY think-path
  ▼
Managed agent chat-companion-v1  (base: antigravity-preview-05-2026)
  ├─ persistent remote container per session (environment_id chained turn to turn)
  ├─ /.agents/AGENTS.md            persona + artifact contract   (shared: ../agents/)
  ├─ /.env                         GEMINI_API_KEY=… — sourced by the launcher, never printed
  ├─ /.agents/bin/gai              launcher → npx -y @lyalindotcom/gai   (shared: ../agents/)
  └─ /.agents/skills/gemini-anything/SKILL.md   media routing via gai --help   (shared: ../agents/)
  │
  │  GET /files/environment-{id}:download   (ustar tar)
  ▼
Client tar parser → IndexedDB media store → inline players/images in the thread
```

The client's only Gemini calls are: the chat/research interaction itself, the snapshot
download, and an `agents.list` ping to validate the key at the gate. There is no client-side
model call of any kind — session titles are plain string math, and voice is shipped into the
chain as audio content the agent hears.

Server-side state discipline: `previous_interaction_id` + `environment_id` are persisted per
session (localStorage index) and REQUIRED on continuations; transcripts and synced media live
in IndexedDB. Reload mid-turn and the app reattaches and fetches the running turn from the
server; reload a finished session and it renders purely from local cache (zero server calls).
If Google expires a chain or environment, the turn self-heals in place with a recap.

One transport quirk (verified against the live API): the SDK's browser build sends an
`Api-Revision` header that fails Google's CORS preflight — the API works fine without it —
so `src/gemini/client.ts` strips that one header in a fetch shim.

## Tuning the agent

Everything installed into the agent's container is a **plain, human-editable file** under
the repo-root [agents/](../agents/) folder — **shared with the Electron app in
[../app/](../app/), so the agent is identical no matter which UI you use**:

| File | Lands in the container as | What it controls |
|---|---|---|
| `../agents/AGENTS.md` | `/.agents/AGENTS.md` | Persona, tool routing, artifact contract |
| `../agents/bin/gai` | `/.agents/bin/gai` | Launcher for the published [`@lyalindotcom/gai`](https://www.npmjs.com/package/@lyalindotcom/gai) media CLI |
| `../agents/skills/gemini-anything/SKILL.md` | `/.agents/skills/gemini-anything/SKILL.md` | Media routing + guardrails; capabilities via `gai --help` |

The user's key ships separately as `/.env` (`GEMINI_API_KEY=…`), the same mechanism the
Electron app uses, so the shared launcher works byte-identically under either UI.

There is deliberately **no agent-level `system_instruction`**: the base agent reads
AGENTS.md on its own (it's additive and can't be displaced), whereas agent-level and
request-level instructions share one slot — a per-request injection would silently knock an
agent-level prompt out. The app uses the request-level slot only for fresh per-call context
(current date/time).

Because the deployed agent is identified by a fingerprint of this whole payload, **any edit
automatically recreates every agent on its next message** — no versions to bump, no buttons
to press. Edit, save (dev) or deploy (prod), send a message, and the agent is running your
new instructions.

## Development

```bash
npm install
npm run dev
```

First launch shows the key gate. `VITE_GEMINI_API_KEY=... npm run dev` adds a dev-only
"Use dev key" button (never in production builds).

### Tests

```bash
npm run test:unit      # stream-adapter merges, params goldens, parts mapping, tar parser
npm run test:live      # real API (GEMINI_API_KEY in .env; skips without it)
```

`.env` is gitignored and NOT `VITE_`-prefixed, so the test key can never reach the bundle.

## Deploy

```bash
firebase deploy --only hosting --project ai-chatbot-agent-54153   # predeploy runs the build
```

This app lives in its own Firebase project (`ai-chatbot-agent-54153`) — always pass
`--project` so a deploy can never land in another project's site.

## Notes & limits

- **Your key travels into the container** (`/.env`, sourced by the `gai` launcher) so the
  agent can self-serve media generation. The container belongs to your key; hit Settings →
  Recreate after rotating it. The Files panel deliberately hides `/.env`.
- The sandbox reaches the internet through an HTTP proxy — `curl`/`urllib`/`npx` work, raw
  sockets/DNS don't.
- Model/agent ids are pinned in [src/models.ts](src/models.ts); `@google/genai` pinned to
  exactly 2.10.0 (`agents`/`interactions` marked experimental upstream).
- Free-tier keys rate-limit fast on agent turns; 429s surface with a retry hint.

## Repo landmarks

[../agents/](../agents/) — everything installed into each agent container (persona,
`gai` launcher, skill), shared with the Electron app · `src/gemini/` — SDK layer, agent
lifecycle, snapshot sync · `src/chat/` — turn controller + part rendering · `tests/` —
unit suites (no network) and live suites (real API, skip without a key).
