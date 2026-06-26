# Gemini Anything Media Skill

Use this skill only when the user asks for a new generated media artifact through Gemini specialized media models or asks to transcribe an existing audio file with Gemini audio understanding.

Do not use this skill for ordinary text answers, code generation, planning, research, shell work, or file edits. Do that work directly as the managed agent.

Do not use this skill for converting, renaming, moving, packaging, trimming, resizing, inspecting, or otherwise transforming an existing file, except audio transcription. Existing artifact work belongs to native managed-agent tools unless the requested operation is transcription, captions, timestamps, or speaker labeling from audio.

Before using this skill, classify the action. If the user refers to an existing artifact with words like "this", "that", "the file", "the podcast", "the audio", "the image", "the video", or "the previous artifact", inspect `/workspace/output` first and resolve the source artifact. Only continue with this skill if the resolved action is new media generation or audio transcription.

## Use The CLI

```bash
export GAI="/.agents/bin/gai"
test -f "$GAI" || { echo "gai wrapper is missing at $GAI; the app must redeploy the managed agent assets." >&2; exit 1; }
```

Run `bash "$GAI" --help` before using the CLI in a fresh environment. Then run the relevant subcommand help, such as `bash "$GAI" image --help`, `bash "$GAI" video --help`, `bash "$GAI" tts --help`, or `bash "$GAI" transcribe --help`. Follow the current help output; it is the source of truth.

Respect the help syntax exactly:

- `<name>` means the argument is required.
- `[name]` means the argument is optional.
- If `tts --help` shows `<prompt>`, include a positional prompt even when using `--script-file`.
- If `tts --help` shows `[prompt]`, `--script-file` may be used without a positional prompt.

Use `--json` for generation commands so results are machine-readable.

## Routing

Use the CLI only for:

- Images: still images, edits, posters, logos, mockups, diagrams, thumbnails, product shots, or visual assets.
- Video: moving scenes, cinematic clips, animations, camera movement, portrait or landscape video, or MP4 output.
- TTS: narration, voiceover, spoken dialogue, podcasts, or WAV output.
- Transcription: an existing audio file to text, Markdown, captions, timestamps, or speaker-labeled transcript.

For clear simple video requests, proceed with the lite/default route shown by `video --help`. Ask the user before starting video generation only when the request is ambiguous, asks for premium/long/high-resolution output, or could be expensive.

For podcast or long narration requests, write the script to `/workspace/output/<name>.txt`, inspect `bash "$GAI" tts --help`, then use the CLI's script-file option if available while respecting whether the prompt argument is required.

For audio transcription requests, inspect `/workspace/output`, resolve the source audio file, inspect `bash "$GAI" transcribe --help`, then write the transcript under `/workspace/output`. Prefer Markdown unless the user asks for plain text, JSON, or `.srt` captions.

## Guardrails

Never run bare `gai ...`.
Never create your own wrapper, install script, Python helper, or alternate executable path.
Never execute `dist/cli.js`, `cli.js`, or files inside the npm cache directly.
Never run `npm install`, `npm info`, `npm view`, `curl`, `printenv`, `find /`, package-file inspection, or Node one-off diagnostics yourself.
Never use `--dry-run` unless the user explicitly asks for a dry run.
Do not inline or print `GEMINI_API_KEY`; rely on the existing environment.

For an explicit image, video, TTS, or transcription request, run the command directly after checking help. Do not run `doctor` first unless the command fails for an unclear local readiness reason.

If a command fails with `API_KEY_INVALID`, `BadRequestError`, `APIConnectionError`, `fetch failed`, permission errors, or package install errors, stop and report the error plainly. Do not run extra diagnostics unless the user explicitly asks.

If a command returns JSON with `"ok": false`, treat that as the final result for that request. Do not retry the same request with different flags, voices, models, diagnostics, shorter text, or alternate files unless the user explicitly asks.

After generation or transcription, verify the output file exists and report the exact sandbox path. Keep failure responses short: name the failed command type, the error message, and whether any artifact was created.
