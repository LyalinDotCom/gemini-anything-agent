# Gemini Anything Agent

Gemini Anything Agent is an unofficial sample that explores a simple idea: a managed agent can act as a long-running content container. The user talks to one agent, the agent keeps conversation and workspace continuity, and specialized model capabilities are exposed through a small CLI only when they are needed.

The goal is not to make the user choose a model or API surface. The app sends the request to one preconfigured Gemini Managed Agent. The agent decides whether it can answer directly with its normal tools, whether it needs to inspect existing artifacts, or whether it should call the `gai` CLI to create a new image, video, speech file, or transcript.

## Status

This is an experimental, unofficial sample.

It is not a supported Google product, not an official Gemini sample, and not production software. It is shared as-is for learning and prototyping. Use it at your own risk.

This repository does not accept contributions. Issues and pull requests may be ignored or closed.

Be careful with cost. Managed-agent runs, search, code execution, long context, media generation, video generation, transcription, retries, and accidental loops can consume tokens or billable API usage quickly. Use real API keys only with appropriate budget controls, monitoring, quotas, and product-specific guardrails.

## Components

### 1. The App

The Electron app in `app/` is the local chat harness.

It gives the user a single chat interface backed by one managed agent, not a model picker. Conversations are stored locally, and each conversation is shown as a long timeline of user turns, agent thinking, tool activity, responses, and generated artifacts.

The app is responsible for:

- Loading local configuration from `.env`.
- Ensuring the managed agent exists before chat starts.
- Recreating the managed agent when the mounted prompt, skill, wrapper, or environment configuration changes.
- Sending user prompts to `GEMINI_ANYTHING_AGENT_ID`.
- Keeping continuity by passing the latest `previous_interaction_id` for conversation context.
- Reusing the latest managed-agent `environment_id` so files in the remote workspace remain available across turns.
- Showing reconnect and retry controls when a streamed interaction is interrupted.
- Downloading generated media from the remote environment and saving it locally under `outputs/managed-agent/`.
- Rendering inline previews for images, video, and audio.
- Saving text outputs such as transcripts when the user wants a local file.

Run it locally:

```bash
cd app
npm install
npm run dev
```

The renderer can be previewed with `npm run dev:web`, but live managed-agent calls require Electron because the API key stays in the main process.

### 2. The Managed Agent

The managed-agent behavior is defined in `agents/`.

The saved agent is based on the Antigravity managed agent and runs in a remote Google-hosted Linux sandbox. The app mounts these files into the remote environment:

- `agents/system-prompt.md` as the primary saved system instruction.
- `agents/AGENTS.md` as concise workspace instructions.
- `agents/skills/gemini-anything/SKILL.md` as the media-routing skill.
- `agents/bin/gai` as the hard-path CLI wrapper at `/.agents/bin/gai`.
- A generated `.env` file with `GEMINI_API_KEY` and package configuration.

The key flow is intentionally simple for the proof of concept: the local app reads the repo-root `.env`, builds the managed-agent environment, and mounts an inline `.env` file into the remote sandbox. The wrapper at `/.agents/bin/gai` sources that file before it runs the npm package, so the managed agent can call specialized media APIs without asking the user for a key on every turn.

That is not encrypted secret management. The local `.env` file and the generated sandbox `.env` source should be treated as plaintext secrets. Do not use high-privilege keys, do not commit real keys, and do not treat downloaded environment snapshots or logs as safe places for secrets.

The agent is told where it is running, where durable artifacts belong, and how continuity works:

- Remote workspace root: `/workspace`
- Durable artifact folder: `/workspace/output`
- Mounted instructions: `/.agents`
- CLI wrapper path: `/.agents/bin/gai`
- Conversation continuity: `previous_interaction_id`
- Workspace/file continuity: `environment_id`

The agent should use its native managed-agent tools for normal work: text answers, coding, planning, research, browsing, file inspection, shell work, file edits, summaries, and multi-step tasks.

It should use `gai` only for specialized media creation and audio transcription. Existing artifact transformations, such as converting WAV to MP3 or renaming a file, should be done with normal shell/file tools after inspecting `/workspace/output`.

### 3. The CLI

The CLI in `cli/` is published as [`@lyalindotcom/gai`](https://www.npmjs.com/package/@lyalindotcom/gai).

It is a thin media capability wrapper around the GenAI SDK. It exists so the managed agent has one dependable command surface for specialized model abilities while the agent itself handles all reasoning, planning, and ordinary text work.

Supported commands:

```bash
npx -y @lyalindotcom/gai@latest --help
npx -y @lyalindotcom/gai@latest models
npx -y @lyalindotcom/gai@latest image --help
npx -y @lyalindotcom/gai@latest video --help
npx -y @lyalindotcom/gai@latest tts --help
npx -y @lyalindotcom/gai@latest transcribe --help
```

Inside the managed-agent sandbox, the agent does not call `npx` directly. It calls the mounted hard path:

```bash
export GAI="/.agents/bin/gai"
bash "$GAI" --help
bash "$GAI" image --help
bash "$GAI" video --help
bash "$GAI" tts --help
bash "$GAI" transcribe --help
```

The wrapper then runs the configured npm package/version, usually [`@lyalindotcom/gai@latest`](https://www.npmjs.com/package/@lyalindotcom/gai). This keeps the agent prompt stable while allowing the package implementation to be updated independently.

CLI development:

```bash
cd cli
npm install
npm test
npm run build
npm run gai -- models
```

Live CLI calls require `GEMINI_API_KEY` in the environment or repo-root `.env`.

## How It Works

1. The user opens the app and sends a message.
2. The app ensures the managed agent exists with the current prompt, skills, wrapper, and environment sources.
3. The app sends the prompt to the one configured agent.
4. The app includes continuity pointers by default, so the agent can remember previous turns and reuse files in the same remote workspace.
5. The managed agent classifies the task:
   - Answer directly for text, research, coding, planning, and normal file work.
   - Inspect `/workspace/output` when the request refers to an existing artifact.
   - Use `gai image` for new image generation or image edits.
   - Use `gai video` for new video generation.
   - Use `gai tts` for narration, podcasts, dialogue, and voiceover.
   - Use `gai transcribe` for transcripts, captions, timestamps, and speaker-labeled audio output.
6. The agent writes durable files under `/workspace/output`.
7. The app detects generated media paths, downloads them from the managed environment snapshot, stores them locally, and shows previews inline.
8. The user can continue the conversation, ask for changes, transform existing files, or start a new local conversation.

## Example Scenarios

Ask for a normal answer:

```text
Summarize the current project structure and suggest the next three engineering tasks.
```

The managed agent should answer directly using its normal reasoning and file tools.

Ask for an image:

```text
Make me a square app icon for a CLI that generates anything with Gemini.
```

The managed agent should use `gai image`, save the output under `/workspace/output`, and the app should download and preview it.

Ask for a video:

```text
Make a short video of a cute cat playing with string in a cozy Pacific Northwest home.
```

The managed agent should use `gai video`. Video generation can take longer and may be more expensive than text or image generation.

Ask for a podcast:

```text
Look at Hacker News and create a short recap podcast.
```

The managed agent should research with its native tools, write a script under `/workspace/output`, then use `gai tts` to create audio.

Ask to transform an existing artifact:

```text
Convert that WAV podcast to MP3.
```

The managed agent should inspect `/workspace/output`, resolve the previous audio file, and use normal shell tools such as `ffmpeg`. It should not call `gai` for a format conversion.

Ask for transcription:

```text
Transcribe the latest podcast with timestamps and speaker labels.
```

The managed agent should inspect `/workspace/output`, resolve the source audio file, and call `gai transcribe`.

## Configuration

Create a repo-root `.env`:

```bash
cp .env.example .env
```

Important variables:

```bash
GEMINI_API_KEY=
GEMINI_ANYTHING_AGENT_ID=gemini-anything-agent
GEMINI_ANYTHING_NPM_PACKAGE=@lyalindotcom/gai
GEMINI_ANYTHING_NPM_VERSION=latest
GEMINI_ANYTHING_TRANSCRIBE_MODEL=gemini-3.5-flash
```

The app injects the configured key and package settings into the managed-agent remote environment. Do not commit real keys. `.env` is ignored by git.

For this sample, the key is passed to the managed agent by mounting a plaintext `.env` file into the remote sandbox. This keeps the demo easy to run, but it is not a secure production secret-store pattern. Use restricted keys, quotas, billing alerts, and key rotation if you experiment with live credentials.

## Repository Layout

```text
app/                         Electron chat harness
agents/                      Managed-agent prompt, skill, and mounted wrapper
agents/bin/gai               Sandbox wrapper that runs the npm CLI
agents/skills/gemini-anything/SKILL.md
cli/                         @lyalindotcom/gai package source
outputs/                     Local downloaded artifacts, ignored by git
```

## Safety Notes

This sample intentionally gives an agent broad ability to reason, browse, run code, create files, and call specialized generation APIs. That is the point of the experiment, but it also means guardrails matter.

Before adapting this idea for real users, add controls for:

- API spend limits and quota alerts.
- Restricted, rotated API keys rather than broad personal keys.
- Proper secret storage instead of plaintext `.env` injection.
- Media generation limits, especially video.
- Timeouts and cancellation.
- File type and file size restrictions.
- Prompt and content policy checks appropriate to your product.
- User-visible confirmation for expensive actions.
- Logging and audit trails that do not expose secrets.
- Clear handling of remote sandbox files versus local downloaded files.

Treat this repository as a prototype, not an operational template.
