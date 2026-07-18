# Electron → Web capability parity

Verified 2026-07-18. Electron is the reference surface; the web app implements the
same user-facing workflow with browser-native equivalents where operating-system APIs
differ.

| Capability | Electron | Web implementation | Evidence |
| --- | --- | --- | --- |
| API key gate/update/clear | Root `.env` via IPC | Browser-local key gate and Settings | Browser UI QA; production build |
| Agent profiles | Antigravity, Anything, Browser, Deep Research, Max | Same five profiles and pinned ids | `agentProfiles.unit.test.ts`; browser UI QA |
| Descriptive agent card | Description + Gemini 3.5 Flash | Same cards, outside-click/Escape close | Direct browser interaction |
| Shared agent payload | Reads `agents/` from disk | Vite raw-imports the same `agents/` files | `envSources.unit.test.ts` |
| Agent-aware examples | 10 cards | Same 10 prompts, images, and profile tags | Direct browser interaction |
| Inputs | Text + multiple images | Text + multiple images + voice | Production build; existing media tests |
| Streaming timeline | Thought/tool/code/output steps | Thought/tool/code/output steps | `streamAdapter` and `blocksToParts` tests |
| Background execution | Stored interaction + reconnect | Stored interaction + polling/reload recovery | Live Browser profile test |
| Cancel/retry | Server cancel + restore prompt | Server cancel + restore text/image/audio prompt | Browser UI and controller coverage |
| Continuity controls | Context and sandbox reuse | Same, plus persisted per conversation | Params unit tests |
| Advanced request controls | Store, background, tier, thinking, system, tools, ids | Same controls | Params unit tests; browser UI QA |
| Parallel chats | Independent runs per conversation | Independent per-session controllers | Store/controller contract |
| Local history | Readable chat folders | IndexedDB/localStorage plus linked-folder Markdown/JSON metadata | Local project unit test |
| Session management | New/delete/rename/reorder | New/delete/rename/reorder | Store + direct browser QA |
| Snapshot download | Save `.tar` | Download exact `.tar` | Production build; live snapshot test |
| Output panel | Refresh, per-file save/open | Refresh, download, local-folder sync | Direct browser QA |
| Media previews | Image/audio/video | Image/audio/video | Existing renderer paths + build |
| Document previews | Sandboxed HTML + Markdown/text | Sandboxed HTML + Markdown/text | Production build |
| Response actions | Copy/save + duration | Copy/save + duration/token usage | Production build |
| Diagnostics | Interaction/environment/status | Same ids, pending state, output state, cancel | Direct browser QA |
| Reload recovery | Resume/reconnect | Pending-turn and research reattachment | Controller/live tests |
| Responsive UI | Desktop app window | Desktop + mobile drawer/panels | 390×844 direct browser QA |
| About/settings | Separate overlays | Separate overlays | Direct browser QA |

## Web-only local project folders

On supported desktop Chromium browsers, `showDirectoryPicker({mode: "readwrite"})`
lets the user explicitly link a folder. The handle is stored in IndexedDB. Sync writes
only visible `/workspace/output` paths plus `.gemini-anything/conversation.json` and
`conversation.md`; it rejects traversal, hidden remote paths, credentials, and runtime
caches. It updates matching files but never deletes unrelated local files.

The API requires a secure context and a user gesture, and it is not supported in every
browser. The UI feature-detects it and falls back to downloading the exact environment
snapshot. References: [Chrome File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access),
[MDN `showDirectoryPicker`](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker).

## Large snapshot handling

The first real web Browser-profile run produced a valid environment archive over the old
100 MB limit. The web path now parses the response incrementally and retains only selected
output entries, so unrelated container bodies are skipped without first buffering the full
tar. Snapshot download still returns the original archive unchanged.

## Verification commands

```bash
cd web
npm test
npm run build
npm run test:live

cd ../app
npm test
npm run build
```

The live Browser profile test creates a disposable managed agent, runs TodoMVC in the
headless Linux browser, verifies two todos with exactly one complete, validates the PNG
signature and JSON report pulled from the environment snapshot, then deletes the test
interaction and agent.
