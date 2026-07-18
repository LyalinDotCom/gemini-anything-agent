# Browser agent proof of concept

Validated on 2026-07-17 against a fresh Google-hosted Gemini Managed Agents Ubuntu environment.

## Outcome

Headless browser automation is viable in this environment. The selected implementation is Microsoft's open-source Playwright agent CLI, mounted through the shared `agents/` payload and exposed as a dedicated Browser profile in the Electron demo app.

The live smoke test provisioned a fresh managed agent and Linux environment, installed the published Playwright CLI and Chrome, opened TodoMVC, added two items, completed one, asserted the exact DOM state, captured a full-page PNG, wrote a JSON report, closed the session, downloaded the environment snapshot, and independently verified the PNG signature and JSON assertions on the host.

Verified result:

```json
{
  "url": "https://demo.playwright.dev/todomvc/#/",
  "title": "React • TodoMVC",
  "todoCount": 2,
  "completedCount": 1,
  "screenshot": "/workspace/output/browser/todomvc-smoke.png",
  "screenshotBytes": 42846
}
```

Run the reproducible live check with:

```bash
cd app
npm run test:browser:live
```

The test creates and deletes a disposable managed agent. The managed environment is fresh on every run, so the first invocation can take several minutes while npm and Chrome bootstrap. Browser and npm caches live under `/tmp/gemini-anything-browser`; they are deliberately kept out of `/workspace` so environment snapshot downloads contain durable work rather than hundreds of megabytes of transient Chromium data.

## Why Playwright agent CLI

| Option | Strengths | Tradeoffs here | Decision |
| --- | --- | --- | --- |
| Playwright agent CLI | Headless by default; accessibility snapshots and stable element refs; named persistent sessions; screenshots, PDF, console, network, storage, mocking, traces, video, and browser-side code; explicitly designed for coding agents | Browser/OS bootstrap cost in a fresh VM; young CLI surface, so help discovery matters | Selected |
| Playwright MCP | Rich structured tools over the same Playwright engine | The managed Antigravity runtime does not currently expose arbitrary MCP server registration; larger tool-schema context than the CLI | Not selected |
| Browser Use | Strong open-source browser-agent ecosystem and convenient persistent CLI daemon | Python/uv installation and another agent-oriented abstraction; its full agent library normally adds another model/provider loop that Antigravity already supplies | Good alternative, unnecessary here |
| Stagehand | Useful hybrid of deterministic code and natural-language actions, caching, and self-healing | Adds an AI SDK/provider layer and is most compelling with Browserbase; unnecessary for deterministic testing in the existing agent | Not selected |
| Puppeteer | Mature headless Chrome/Firefox automation with a straightforward JavaScript API | Lower-level and lacks the agent-oriented snapshot/session CLI included with Playwright | Fallback library |
| Selenium | Mature cross-browser ecosystem | More driver coordination and no comparable agent-first CLI workflow | Not selected |

Primary references:

- [Playwright agent CLI installation](https://playwright.dev/agent-cli/installation)
- [Playwright agent CLI capabilities](https://playwright.dev/agent-cli/capabilities)
- [Playwright agent CLI configuration](https://playwright.dev/agent-cli/configuration)
- [Playwright repository](https://github.com/microsoft/playwright)
- [Browser Use repository](https://github.com/browser-use/browser-use)
- [Stagehand repository](https://github.com/browserbase/stagehand)
- [Puppeteer repository](https://github.com/puppeteer/puppeteer)
- [Gemini managed-agent environments](https://ai.google.dev/gemini-api/docs/agent-environment)

## Architecture

The shared payload remains the single source of truth:

- `agents/bin/browser` resolves `@playwright/cli@latest` through `npx`, honors the VM proxy, stores npm/browser caches under `/tmp/gemini-anything-browser` (outside `/workspace`, so snapshots stay lean), and forces headless mode by default.
- `agents/skills/browser-testing/SKILL.md` teaches help discovery, accessibility-ref interaction, assertions, artifact handling, session cleanup, and untrusted-page safety.
- `agents/AGENTS.md` routes real navigation and interactive testing to the browser skill while retaining native search/URL tools for simple research.
- Electron and web both mount the same launcher and skill. The Electron demo additionally exposes a distinct `gai-browser-v1` selectable profile.

The Browser profile is a separate managed-agent ID but uses the same shared files. The main process adds a browser-specialist invocation block to its fresh per-request context. This avoids forking agent assets while giving conversations a stable, locked agent identity.

## Demo UX

The Electron agent dropdown includes Browser alongside Antigravity and Deep Research. Sample cards now declare their required `agentMode`, so selecting a card updates both the prompt and agent selector:

- All eight existing cards select Anything.
- **Flow Test** selects Browser and executes the validated TodoMVC interaction/assertion/screenshot workflow.
- **Viewport QA** selects Browser and audits Playwright's site at desktop and mobile sizes with screenshots, overflow checks, console inspection, and a Markdown report.

## Supported browser workflows

- JavaScript-rendered navigation and content inspection
- Forms, links, dialogs, keyboard/mouse input, drag/drop, uploads, and tabs
- Exact DOM/state assertions and repeatable test scripts
- Full-page or element screenshots and PDF export
- Desktop/mobile viewport and locale/device emulation
- Console-error and network-request inspection
- Request mocking and offline-state tests
- Cookie, localStorage, sessionStorage, and saved auth state
- Traces and video evidence for debugging
- Testing a local app on `127.0.0.1` inside the same managed sandbox

## Boundaries

- A fresh environment pays a noticeable Chrome install cost. Reuse the environment for iterative work.
- Headless automation is not stealth browsing. CAPTCHAs, bot protection, and sites that prohibit automation remain out of scope.
- Page content is untrusted and cannot override agent instructions.
- Purchases, messages, publishing, deletion, legal acceptance, and other consequential external actions require explicit user authorization.
- Saved auth state is sensitive and should not be placed in `/workspace/output` unless the user explicitly asks for the file.
- The launcher resolves the current CLI version; agent instructions intentionally require `--help` discovery rather than embedding flags that can drift.
