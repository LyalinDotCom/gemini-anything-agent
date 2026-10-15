# Gemini Anywhere Agent — Web

The browser UI for the Gemini Anywhere Agent managed agent (the Electron UI lives in
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
- **Real browser testing** — headless Playwright navigation and interaction, with screenshots,
  accessibility snapshots, console/network inspection, traces, videos, PDFs, and deterministic assertions
- **Media, generated IN the container** — the agent runs the published
  [Google’s official Gemini API CLI](https://github.com/google-gemini/gemini-api-cli) v0.4.2
  from inside its own sandbox and saves to `/workspace/output/`; capabilities are
  discovered live with `bash /.agents/bin/gemini-api --help`, never hardcoded
- **Media sync** — after each turn the client pulls the environment snapshot (tar), imports
  new `/output/` files into IndexedDB, and renders them inline (images/audio/video/files)
- **Linked local projects** — Chrome/Edge users can grant a local folder and sync the
  `/workspace/output` project tree directly to disk; other browsers download the snapshot
- **Container files panel** — browse, preview, download, or snapshot anything in the sandbox
- **Six selectable profiles** — Antigravity (default), Anywhere, Browser, 3D View,
  Deep Research, and Deep Research Max, pinned per conversation
- **Photo to 3D View** — upload a photo or choose a rocket/person-and-cat sample; the
  agent uses Google's official Gemini API CLI v0.4.2 inside its Linux sandbox for
  isolated references and orbit views. Native tools plus Blender produce `.blend`,
  textured GLB, preview, and a motion clip.
  Original photos use private Gemini Files API references verified by byte count and
  SHA-256. The experimental environment binary upload currently drops file bodies.
  Only the full-circle photographic 3D View is offered. The gallery attaches the
  original person-and-cat photo and has a direct sample link below its card.
  Coverage must include both opposite profiles; native checks reject likely
  out-and-back sequences and the viewer uses inspected angles.
  Faces and fur remain image textures with transparent backgrounds.
  GLB outputs open in an interactive viewer with motion, zoom, reset and backdrop
  controls. Generic meshes still support wireframe. The public sample at
  `?sample3d=person-cat` needs no key; new agent runs require a key. Unseen views
  are inferred photographs, not a measured scan. No third-party hosted 3D service
  is used. Blender remains available, including legacy mesh experiments.
- **Advanced run controls** — persistence, context/environment reuse, background execution,
  service tier, thinking summaries, tool overrides, system instructions, and explicit ids
- **Agent-aware examples** — the same ten one-click demo cards as Electron select both the
  prompt and the required Anywhere or Browser profile
- **Deep Research + Max** — background research sessions that survive reloads
- **Voice messages** — mic audio goes straight into the chain; the *agent* hears it (no
  client-side transcription)

## Architecture: nothing intelligent happens on the client

```
Browser (static, key in localStorage)
  │  interactions.create({agent, previous_interaction_id, environment})   ← the ONLY think-path
  ▼
Selected profile
  ├─ Antigravity → antigravity-preview-09-2026 directly
  ├─ Anywhere    → gaa-anywhere-v1 custom managed agent
  ├─ Browser     → gaa-browser-v1 custom managed agent
  ├─ 3D View     → gaa-object3d-v1 custom managed agent
  ├─ Large Images → gaa-large-image-v1 custom managed agent
  └─ Research    → deep-research[-max]-preview-04-2026
  ├─ persistent remote container per session (environment_id chained turn to turn)
  ├─ /.agents/AGENTS.md            persona + artifact contract   (shared: ../agents/)
  ├─ /.env                         GEMINI_API_KEY=… — sourced by the launcher, never printed
  ├─ /.agents/bin/gemini-api              checksum-verified official CLI launcher   (shared: ../agents/)
  ├─ /.agents/skills/gemini-anywhere/SKILL.md   media routing via the mounted launcher help (shared: ../agents/)
  ├─ /.agents/bin/browser          launcher → npx -y @playwright/cli      (shared: ../agents/)
  └─ /.agents/skills/browser-testing/SKILL.md   browser workflow + safety rules (shared: ../agents/)
  │
  │  GET /files/environment-{id}:download   (ustar tar)
  ▼
Streaming tar filter → IndexedDB media store → previews/downloads/local linked folder
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
| `../agents/bin/gemini-api` | `/.agents/bin/gemini-api` | Launcher for Google’s official Gemini API CLI |
| `../agents/skills/gemini-anywhere/SKILL.md` | `/.agents/skills/gemini-anywhere/SKILL.md` | Media routing + guardrails; capabilities via `bash /.agents/bin/gemini-api --help` |
| `../agents/bin/browser` | `/.agents/bin/browser` | Headless launcher for the published [`@playwright/cli`](https://playwright.dev/agent-cli/installation) package |
| `../agents/skills/browser-testing/SKILL.md` | `/.agents/skills/browser-testing/SKILL.md` | Browser workflow, artifact contract, and untrusted-page safety rules |

The user's key ships separately as `/.env` (`GEMINI_API_KEY=…`), the same mechanism the
Electron app uses, so the shared launcher works byte-identically under either UI.

There is deliberately **no agent-level `system_instruction`**: the base agent reads
AGENTS.md on its own (it's additive and can't be displaced), whereas agent-level and
request-level instructions share one slot — a per-request injection would silently knock an
agent-level prompt out. The app uses the request-level slot only for fresh per-call context
(current date/time, optional user override, and Browser-profile invocation guidance).

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
npm run test:unit      # profiles, params, state, stream/tar parsing, local-folder sync
npm run test:live      # real API + real Linux Browser profile (skips without a key)
```

`.env` is gitignored and NOT `VITE_`-prefixed, so the test key can never reach the bundle.

## Deploy

```bash
firebase deploy --only hosting --project ai-chatbot-agent-54153   # predeploy runs the build
```

This app lives in its own Firebase project (`ai-chatbot-agent-54153`) — always pass
`--project` so a deploy can never land in another project's site.

## Notes & limits

- **Stored connections** — Options → Use stored credential binds a credential ID
  from this Gemini project to one API hostname. Follow-up turns preserve the
  existing environment. Switching the option off clears the selected connection's
  injection on the next turn; it does not revoke the OAuth grant.
- **OAuth sign-in** — A shared deployment needs an authenticated backend for the
  provider callback, client secret, token exchange, credential registration, and
  per-user ownership checks. `src/gemini/credentials.ts` provides BYOK credential
  adapters; direct browser CORS behavior still needs live verification. The repo's
  server-side handoff and live scenario are described in [../app/README.md](../app/README.md#credential-scenario).

- **Your key travels into the container** (`/.env`, sourced by the official CLI launcher) so the
  agent can self-serve media generation. The container belongs to your key; hit Settings →
  Recreate after rotating it. The Files panel deliberately hides `/.env`.
- The sandbox reaches the internet through an HTTP proxy — `curl`/`urllib`/`npx` work, raw
  sockets/DNS don't.
- Model/agent ids are pinned in [src/models.ts](src/models.ts); `@google/genai` pinned to
  exactly 2.29.1 (`agents`/`interactions` marked experimental upstream).
- Free-tier keys rate-limit fast on agent turns; 429s surface with a retry hint.
- Direct folder linking uses the permission-gated File System Access API and therefore
  requires desktop Chrome/Edge and HTTPS (localhost works for development). Folder handles
  are kept in IndexedDB; the app never deletes existing local files. Safari/Firefox use the
  downloadable `.tar` snapshot fallback.
- Large environment snapshots are parsed as a stream. The web app skips non-output tar
  bodies instead of buffering npm/browser caches before it can reach user artifacts.

## Repo landmarks

[../agents/](../agents/) — everything installed into each agent container (persona,
media/browser launchers and skills), shared with the Electron app · `src/gemini/` — SDK layer, agent
lifecycle, snapshot sync · `src/chat/` — turn controller + part rendering · `tests/` —
unit suites (no network) and live suites (real API, skip without a key).


Large Images uses the shared generic `gigapixel-gemini-mosaic` skill. The Dr. Seuss World example adds the shared `dr-seuss-world` skill; generic work takes its subject/style from the user. All generated regions use the official Gemini API CLI inside the managed Linux agent. Native tools compose real regional detail into the requested canvas, preserve full PNG/JPEG, and create `deepzoom.zip`. The web app opens its trusted zoom viewer and downloads full-resolution files on demand; linked folders receive files individually.

The published large-image example is a fresh 13,334 × 7,500 image with 49 separately generated regions. Native composition checkpoints survive container restarts. Visual inspection includes 1:1 joins; incompatible objects can be corrected by editing native crops with Gemini, with patch provenance recorded separately. A numeric seam pass does not certify every join.

Peer-review standard: Claude Opus 5.5 High and Gemini 4 Argon Medium through AGY; the primary agent verifies findings and owns implementation. The reusable workflow is installed in the personal `peer-programming` skill.

Web modernization (October 2026): SDK 2.29.1, current React/Vite/TypeScript/Vitest releases, Antigravity 09-2026 with its Gemini 3.8 Flash default, and official CLI media defaults discovered at runtime. CLI installation uses a durable checksum-verified cache and never needs npm. Payload upgrades start a current workspace and preserve the conversation recap, cached artifacts and original workspace. Prior working inputs can be recovered with the official environment-file CLI; the app never uploads a replacement snapshot. The browser SDK uses a scoped fetch hook rather than changing global fetch.

## Generated sample assets

Run `npm run samples:sync` before deploying from a clean clone. It restores checksum-verified photographic 3D models and the 100 MP example from this project’s Firebase Hosting site. Generated binaries are deliberately excluded from Git. The source viewer, skills, validation and provenance remain in the repository.

## Modernized web runtime (2026-10-14)

All selectable profiles mount the same official `google-gemini/gemini-api-cli` v0.4.2 launcher and shared skills. The browser uses `@google/genai` 2.29.1; React, Vite, TypeScript and test dependencies were updated together. Gemini 3.8 Flash and Gemini 4 Argon are configurable at managed-agent creation, with separate stable agent IDs.

A payload, model or credential change starts a fresh workspace with current instructions. The conversation recap and previous workspace reference survive failed retries, so the agent can recover selected inputs through the official CLI instead of regenerating them. Existing workspaces remain available. Native processing runs headlessly and media generation stays inside the managed Linux agent.

Validation included live image, TTS, transcription, video, music and HTML artifact creation, selected-file recovery from an older workspace, browser gallery routing, Gemini 4 migration, file previews and reload recovery. The requested Opus 5.5 High and Gemini 4 Argon Medium review pair reviewed the modernization. The user's exact reported SDL error was not reproduced; unsupported custom-agent configuration and stale CLI/workspace behavior were reproduced and fixed.

The reasoning model selector is always visible beside the harness picker (including the baseline Antigravity harness), with exactly Gemini 3.8 Flash and Gemini 4 Argon. Baseline calls send `{ type: "antigravity", model }` in `agent_config`; custom agents configure the model at creation. Live paid-key checks verified both models and native output-file retrieval. On 2026-10-14 the Managed Agents endpoint rejected `agent_config.thinking_level` for both medium and high with HTTP 400, so the UI does not expose unsupported effort controls. Re-run `BASELINE_MODELS_LIVE=1 npm exec -- vitest run tests/baselineModels.live.test.ts` with a paid key to verify this contract.

The model is selected before the first submitted turn and then pinned for that conversation. Completing, cancelling, stopping or failing a turn does not unlock it. Choose **New chat** to use another model. This is the harness's conversation policy: Google's baseline Antigravity API accepts per-interaction configuration, while a saved custom agent's model is fixed at creation.

## GAA chat navigation

**New chat** always creates a fresh conversation, including while another chat runs. Mobile has a direct header shortcut and a history drawer that closes when you select a chat, create a chat, or open settings/about. Chats receive a title from their first prompt immediately; explicit renames remain yours. Unsent text survives switching chats and reloads, and history shows draft previews. Tabs share the chat index while retaining their own selected conversation and live run state.

The Gemini Anywhere Agent rename intentionally starts fresh browser storage (`gaa-store`, IndexedDB `gaa`, key `gaa.geminiApiKey.v1`) and managed-agent IDs. There are no old-name aliases or migrations. Re-enter your API key after upgrading; earlier browser data is not imported. History stays local to each browser/device.

Navigation validation: 142 web unit tests, TypeScript/production build, 34 native processing tests, live concurrent baseline/Anywhere requests, a real container artifact confirming official CLI 0.4.2 and the renamed skill path, reload recovery, and desktop/mobile history/rename/draft checks. Peer review used Opus 5.5 High and Gemini 4 Argon Medium.

## Composer and health review

The empty composer keeps its geometry while a run works: the working indicator overlays the input and Send/Stop/Resume share one fixed-size control. Actual typed multiline content can still expand the textarea. See [BUG_BASH.md](BUG_BASH.md) for the peer-review decisions, resilience fixes and live verification from the October 14 web health pass.
