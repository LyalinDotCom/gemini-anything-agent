# Web bug bash — 2026-10-14

Reviewed the web source and shared contracts with **Claude Opus 5.5 High** and **Gemini 4 Argon Medium** through AGY. Both reviewed the same bounded source batches and the resulting changes. The primary implementation was checked against source, regressions and real requests; conditional findings were not accepted without evidence.

## Verified fixes

| Area | Result |
| --- | --- |
| Composer | Fixed-size Send/Stop/Resume control, shrink-safe textarea, short placeholder, overlaid working indicator. At 390 px, the empty bar remains 358 × 60 px while running and after completion. Typed multiline text can still grow to five lines. |
| Sending | Attachment preparation cannot submit twice; failures preserve drafts. IME confirmation does not send. Switching chats uses separate composer instances. |
| Voice | Recording is cancelled on unmount, including permission arriving after unmount. Constructor/start failures release microphone tracks. |
| Mobile panels | Files/diagnostics overlay the chat; they do not squeeze its width. New artifacts update the badge without forcing the mobile panel open. Compact layouts include tablet/landscape widths below 1024 px. Viewport state is synchronized after the resize listener is attached. |
| Streams | Terminal events finish without waiting for the connection to close. Acknowledged stored streams fall back to polling after 30 seconds without events; recovery does not create another paid run. Late animation frames cannot overwrite settled replies. |
| Stop and retry | Idle diagnostics cannot stop a completed reply. Confirmed terminal responses release busy state. Pending-run recovery preserves a newly submitted prompt and uploads as an unsent retry. |
| Workspaces | The workflow fingerprint is recorded when the server acknowledges the run or binds the photo workspace. A failed first turn does not falsely upgrade/discard that workspace. |
| Research | Shared chat locks, hydrated recovery, retryable network failures, confirmed cancellation, and permanent permission failures have explicit handling. Permanent failures release tracking and retain the interaction ID in the reply. |
| Persistence | Read errors are distinct from empty history; aborted writes reject. Quota failures preserve current in-page state. A failed transcript save keeps the completed reply and offers a save-only retry. |
| Files | Missing cached resources can be restored from their original environment; failures show an error instead of an endless spinner. Preview state is keyed by resource identity. File sync no longer resets active previews. |
| Local folders | Permission is obtained before network waits. Persisted fingerprints prevent unchanged remote output from overwriting local edits after a reload. Missing folder handles can be relinked. |
| Archives | GNU long link targets resolve, truncated bodies fail visibly, and materialized hard links respect the size cap. Unresolved snapshot links use individual file downloads rather than buffering workspace caches. |
| Agent/key handling | Settings targets the active managed profile and pinned model; agent existence is verified each turn. Active requests capture their SDK client/key. Browser key fallback works when storage writes fail. Wiping local data includes the stored key. |
| Images | Streamed image bytes render directly; 3D input retains original uploaded files when switching profiles. Compression preserves PNG/WebP transparency. |

## Verification

- **175 web unit tests** and **34 native processing tests** passed.
- TypeScript and the production build passed; the full dependency audit reported **0 vulnerabilities**.
- A synthetic development-key build canary was absent from production JavaScript.
- Paid-key live requests verified both supported baseline models, each writing and downloading an actual `42` artifact.
- The official CLI generated a new image and WAV, then transcribed that WAV inside a managed Linux agent. Actual CLI version: **0.4.2**.
- A browser-driven Anywhere/Argon run created and previewed `health-check.json`, confirming CLI 0.4.2 and value 42.
- Real research resumed after reload and confirmed cancellation through Google's API.
- Desktop and narrow Chrome viewport checks covered history, working/idle composer dimensions, pinned models, diagnostics, resource previews and mobile panel dismissal.

## Review decisions and limits

Model-specific managed-agent IDs and credential-sensitive workflow fingerprints already existed; claims that those contracts were missing were rejected. A production-key leak was not reproduced with the build canary. Composer is keyed per chat, so the proposed cross-chat component-state leak did not apply. AppShell already awaited initial hydration before research recovery; research entry points now also protect themselves.

Browser history remains device/browser-local. Responsive Chrome testing does not certify physical iOS/Safari microphone or folder permission behavior. Unconfirmed server cancellations retain their stored run rather than claiming success. The native file API is preferred; the archive fallback is not advertised as a general-purpose PAX/symlink extractor. Published large media samples were retained, not regenerated by this pass.
