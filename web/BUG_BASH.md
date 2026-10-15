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

- **176 web unit tests** and **34 native processing tests** passed.
- TypeScript and the production build passed; the full dependency audit reported **0 vulnerabilities**.
- A synthetic development-key build canary was absent from production JavaScript.
- Paid-key live requests verified both supported baseline models, each writing and downloading an actual `42` artifact.
- The official CLI generated a new image and WAV, then transcribed that WAV inside a managed Linux agent. Actual CLI version: **0.4.2**.
- A browser-driven Anywhere/Argon run created and previewed `health-check.json`, confirming CLI 0.4.2 and value 42.
- Real research resumed after reload and confirmed cancellation through Google's API.
- Desktop and narrow Chrome viewport checks covered history, working/idle composer dimensions, pinned models, diagnostics, resource previews and mobile panel dismissal.

## Review decisions and limits

Model-specific managed-agent IDs and credential-sensitive workflow fingerprints already existed; claims that those contracts were missing were rejected. A production-key leak was not reproduced with the build canary. Composer is keyed per chat, so the proposed cross-chat component-state leak did not apply. AppShell already awaited initial hydration before research recovery; research entry points now also protect themselves.

Each tab saves its selection in session storage; metadata and transcripts remain shared across tabs. Removing the shared index during a wipe reloads other tabs so they cannot restore deleted history. Browser history remains device/browser-local. Responsive Chrome testing does not certify physical iOS/Safari microphone or folder permission behavior. Unconfirmed server cancellations retain their stored run rather than claiming success. The native file API is preferred; the archive fallback is not advertised as a general-purpose PAX/symlink extractor. Published large media samples were retained, not regenerated by this pass.

## Return-to-app recovery and image continuity (2026-10-14)

The chat now refreshes on visibility return, browser focus, page restoration, lifecycle resume and network reconnection. Events coalesce; idle chats re-read persisted metadata and transcripts, and an existing local owner wakes its transport/poll wait and checks the same stored interaction. Returning or opening a running chat does not submit another generation or cancel remote work. Drafts and per-tab navigation remain intact.

Compared the large-image payload with `LyalinDotCom/sergey-image` at `f2a14d506085146aa696237ea349f330c37599cd`: the source explicitly uses `gemini-nano-banana-2.1`; the managed skill previously left this implicit. The existing published 100 MP sample's provenance truthfully records an older CLI and `gemini-3.1-flash-image`. These are distinct runs, not equivalent outputs. The source's prose also differs from its own executable prompt about miniature character size; the current managed world keeps the executable source's 120–210 px range.

New native `master-request` and region requests carry one explicit image model and the same plan-level camera, scale and composition contract. The world pack specifies continuous daylight and perspective, and generation must visually inspect the master and first adjoining regions before continuing the full grid. Native composition still cannot repair incompatible generated geometry by itself. Generic image context remains user supplied. Existing samples/provenance are not rewritten as new generations.

A direct source comparison also found macro-guide Gaussian sigma 24 in the local engine versus 4 in the managed adaptation. The first live test reproduced the consequence: copied master lettering and enlarged outlines, despite valid native image files. That output was rejected visually. The guide now suppresses fine master outlines at sigma 24, while keeping generated neighbour strips sharp. Master requests translate final-canvas pixel sizes, select the closest documented native aspect ratio and preserve aspect when cropping; regional density is excluded from master instructions. Returning briefly to a healthy stream leaves it attached; stale streams and in-flight polls can be woken. Forced transcript reads preserve concurrent local message patches and never disable saving.

Validation for the return changes: 186 web unit tests and 37 native tests pass, and the production build succeeds. Live browser testing froze a real stored run and recovered `RETURN READY` without reload; a second run was disconnected and frozen, then recovered `RECONNECTED READY` through GETs of the original interaction, with one initial generation POST and no replacement POST/cancel. Phone-width (390×844) and independent-tab draft/navigation checks passed. Opus 5.5 High and Gemini 4 Argon Medium completed both initial and follow-up reviews. Verified issues were fixed; claims that research never sets `streaming`, that rehydration changes a valid per-tab chat selection, or that the wake error triggers expiry self-healing were rejected against the actual call sites and regression tests.

Final live checks: the ordinary/research recovery lock race was reproduced and fixed by selecting exactly one recovery path. Closing the owning tab, then resuming another tab recovered `SESSION RECOVERED` automatically. The current official-CLI image test passed with two native2752×1536 regions on a4500×1536 canvas (6.912MP), generated inside managed Linux using explicit `gemini-nano-banana-2.1`. Primary inspected the actual overview and central1:1 join: consistent perspective/scale, continuous river/railway and no copied title banners. Native QA passed (detail round-trip PSNR23.42; seam ratio0.991). Published proof: `/examples/continuity-check/mosaic.jpg`, with truthful `validation.json` and managed `preflight_report.md`. This is a bounded regression proof, not a regenerated49-region sample. The historical100MP sample remains unchanged. Final suite:188 web tests,37 native tests, build and managed2-region integration pass.

Final phone screenshot inspection caught a long progress chip overflowing the message viewport. Constrained the chip and its shrinking label to the available width; the390px browser check now reports no overflowing buttons and equal chat scroll/client widths.
