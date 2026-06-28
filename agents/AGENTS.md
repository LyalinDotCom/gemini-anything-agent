# Gemini Anything Agent

You are running in a remote managed-agent Linux sandbox.

Workspace facts:

- Workspace root: `/workspace`
- Durable artifact folder: `/workspace/output`
- Mounted agent files: `/.agents`
- Media CLI wrapper: `/.agents/bin/gai`

Repository documentation rule:

- When app behavior, sample prompts, managed-agent flow, CLI routing, or user-visible architecture changes, update `docs/gemini-anything-agent-image-walkthrough.html` when that rich walkthrough is affected. Keep `docs/gemini-anything-agent-image-walkthrough.md` in sync when the same material is represented there.

Repository maintainability rule:

- Keep code split by concern. Do not keep adding unrelated UI, media, output-file, SDK, CLI, and agent-prompt logic into one large file.
- When a file grows hard to review, extract focused components, helpers, or modules before adding more behavior. Prefer small modules with clear ownership over all-in-one files.
- Keep generated-media UI, output-file listing, sample prompts, managed-agent payload construction, SDK calls, and CLI subcommands separated unless there is a strong reason to combine them.

Before choosing tools, classify the request:

1. Answer/research/code/plan: use native managed-agent tools.
2. Create a new media artifact: use `gai` only for image, video, or TTS generation.
3. Transcribe existing audio: inspect `/workspace/output` or resolve the user-provided URL to an audio file, then use `gai transcribe`.
4. Operate on an existing artifact: inspect `/workspace/output`, resolve the source file, then use normal shell/code/filesystem tools.
5. Continue prior work: use prior conversation context plus `/workspace/output` state.

For references like "this", "that", "the audio", "the file", "the image", "the video", "the podcast", or "the previous artifact", inspect `/workspace/output` before selecting tools. Prefer the newest matching artifact when unambiguous; ask briefly if multiple plausible sources exist. If the user gives a podcast or audio web page URL, inspect that page, find the actual audio URL, download it to `/workspace/output`, and transcribe the downloaded file.

Use the `gai` package only for specialized new media generation and audio transcription. Use the mounted hard path from the `gemini-anything` skill, run `bash "$GAI" --help`, then run the relevant subcommand help before generation or transcription. Never use a bare `gai` executable, create a wrapper, run helper scripts, inspect npm-cache files, or search the whole filesystem to locate it.

Do not use `gai` to transform existing files except audio transcription. For conversions, trimming, resizing, packaging, renaming, or moving files, use normal shell/code tools such as `ffmpeg`.

Save durable artifacts in `/workspace/output` and report exact paths.

For transcription, write a Markdown transcript file by default and reply with success/failure plus the path. Do not paste transcript contents into chat unless explicitly asked.

Use `date` or `date -u` when exact current date/time matters. Use web/search for live facts.
