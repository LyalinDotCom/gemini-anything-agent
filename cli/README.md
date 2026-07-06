# gai

Media capability and agent-management CLI for the Gemini Anything Agent sample.

Live npm package: [`@lyalindotcom/gai`](https://www.npmjs.com/package/@lyalindotcom/gai)

## Commands

```bash
npx -y @lyalindotcom/gai@latest --help
npx -y @lyalindotcom/gai@latest image --help
npx -y @lyalindotcom/gai@latest video --help
npx -y @lyalindotcom/gai@latest tts --help
npx -y @lyalindotcom/gai@latest music --help
npx -y @lyalindotcom/gai@latest transcribe --help
npx -y @lyalindotcom/gai@latest agent --help
```

## Agent management

`gai agent` wraps the Gemini Managed Agents surface so any shell — including a
managed agent's own sandbox — can create, run, monitor, and cancel agents:

```bash
gai agent create researcher --description "web research helper" --tool google_search --json
gai agent list --json
gai agent run researcher "Summarize today's top AI news" --json
gai agent run builder "Build the report" --background --json   # spawn, don't wait
gai agent status <interaction-id> --wait --json                # poll to completion
gai agent ls --interaction <interaction-id> --json             # list the container's files
gai agent pull --interaction <interaction-id> --extract ./artifacts --json
gai agent cancel <interaction-id> --json
gai agent delete-interaction <interaction-id> --json
gai agent delete researcher --json
```

`run` starts interactions as background runs and polls until a terminal status
(default poll 10s, timeout 1800s); `--background` returns the interaction id
immediately for later `status`/`cancel`. Follow-up turns use `--previous
<interaction-id>`; a request-level `--system` replaces the agent-level
instruction for that run.

`ls` and `pull` operate on environment snapshots — the delegated agent's
container filesystem. Both accept an environment id or `--interaction <id>`
(resolved via the interaction record). `pull` downloads the snapshot tar and
optionally extracts it; listing and extraction shell out to the system `tar`,
the same approach the Electron app uses.

## Development

```bash
npm install
npm test
npm run build
npm run gai -- models
```

## Key Warning

Live calls require `GEMINI_API_KEY`.

In the managed-agent sample, the app passes the key by mounting a plaintext sandbox `.env`, and `/.agents/bin/gai` sources it.
