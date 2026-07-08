# gai

Agent-facing CLI for the Gemini API: media generation, text generation, embeddings,
file management, and managed-agent orchestration.

Live npm package: [`@lyalindotcom/gai`](https://www.npmjs.com/package/@lyalindotcom/gai)

## Commands

```bash
npx -y @lyalindotcom/gai@latest --help
npx -y @lyalindotcom/gai@latest generate --help    # text, structured output, grounding tools
npx -y @lyalindotcom/gai@latest image --help
npx -y @lyalindotcom/gai@latest video --help
npx -y @lyalindotcom/gai@latest tts --help
npx -y @lyalindotcom/gai@latest music --help
npx -y @lyalindotcom/gai@latest transcribe --help
npx -y @lyalindotcom/gai@latest embed --help
npx -y @lyalindotcom/gai@latest tokens --help
npx -y @lyalindotcom/gai@latest files --help
npx -y @lyalindotcom/gai@latest agent --help
```

## Design for agents

The CLI is built for AI agents calling it from a shell, borrowing the best of the
Anthropic `ant` CLI and OpenAI's CLI tooling:

- **stdout is the deliverable.** `generate` prints only the generated text, `tokens`
  prints only the count, media commands print only the written file paths. Progress
  and errors go to stderr.
- **`--json` everywhere** returns one machine-readable result envelope
  (`{ok, capability, model, outputs, message, details}`) for success and failure alike.
- **`--transform <dot.path>` + `--raw`** extract one field without piping to `jq`:
  `gai image "an icon" --json --transform outputs.0.path --raw` prints just the path.
  Transforms apply to error envelopes too.
- **Typed exit codes:** `0` success, `1` API/runtime failure, `2` invalid usage,
  `3` missing/invalid API key.
- **`--dry-run`** on generative commands shows the exact request without spending quota.
- **Binary output goes to files, never base64 on stdout.** Every media command takes
  `--out` and defaults to a timestamped path under the output directory.

## Text generation

```bash
gai generate "Summarize this file in three bullets" --file notes.md
gai generate "Extract the invoice fields" --file invoice.png --schema ./invoice.schema.json --json
gai generate "What changed in Node 24?" --search --json
gai generate "Write release notes" --system-file style.md --out notes.md
gai embed "a chunk of text" --dim 768 --out chunk.embedding.json --json
gai tokens --file prompt.txt
```

`--schema` (inline JSON or a file path) forces schema-conforming JSON output and
fails with a nonzero exit if the model output does not parse. `--search`,
`--url-context`, and `--code-execution` enable the corresponding grounding tools.

## Files

```bash
gai files upload recording.mp3 --json --transform details.file.name --raw
gai files list --json
gai files get files/abc123 --json
gai files download files/abc123 --out ./local.bin --json
gai files delete files/abc123 --json
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

## Configuration

- `GEMINI_API_KEY` or `GOOGLE_API_KEY` — required for live calls; loaded from the
  environment or any `.env`/`.env.local` walking up from the working directory.
- `GEMINI_ANYTHING_OUTPUT_DIR` — default output directory for generated files.
- `GEMINI_ANYTHING_{TEXT,EMBED,IMAGE,TTS,MUSIC,TRANSCRIBE,VIDEO}_MODEL` and
  `GEMINI_ANYTHING_BASE_AGENT` — per-capability model overrides.

## Key Warning

Live calls require `GEMINI_API_KEY`.

In the managed-agent sample, the app passes the key by mounting a plaintext sandbox `.env`, and `/.agents/bin/gai` sources it.
