---
name: gemini-anywhere
description: Generate images, video, speech or music, transcribe media, and manage Gemini files or delegated agents through Google's official Gemini API CLI.
---

# Gemini API Media Skill

All new media is generated with Google's published `google-gemini/gemini-api-cli` inside this managed Linux agent. Use only `bash /.agents/bin/gemini-api`. Do not install or call another media CLI, implement model calls in Python/REST, inspect package caches, or invent another media wrapper. Ordinary answers, research, planning and code use native managed-agent tools.

Discover the installed command tree with `bash /.agents/bin/gemini-api --help`, then the relevant subcommand's `--help`. Inspect its `--schema` for advanced request bodies; validate unfamiliar inputs with `--dry-run` before a paid call. Validate a dependent operation only after its source exists: dry runs do not generate files. A missing planned output is not a generation failure; run its producer first. The binary's help, usage and schema are the source of truth for supported flags, models, formats and defaults. Do not copy flags from another CLI or an earlier release. Unsupported capabilities must be reported, not replaced with custom API code.

Use the current image, video, TTS, music, analyze or transcribe commands as appropriate. For complete machine-readable output select the format shown by the current help; preserve the returned output path, model and response/interaction ID when present. Media JSON may contain `path`, `response_id`, `model` and `mime_type`; it does not use the retired CLI's `ok`/`outputs` envelope. Save actual CLI responses alongside durable work inputs. Never fabricate IDs.

Resolve existing artifacts before acting. Inspect `/workspace/output` for references such as “this image” or “the podcast”. Convert, trim, resize, inspect, package or move existing files with native tools such as ffmpeg; these operations do not require media generation. Transcription and explicit generative edits use the CLI with the actual source as input, following current help.

For a podcast URL, resolve the episode's real audio source and download it into the working directory. For files beyond the inline limit reported by help, upload through the official Files command and pass the returned file reference. Do not fetch YouTube webpages and pretend they are audio; use supported URL input when available. Write the transcript as Markdown by default and report its path rather than pasting its contents unless requested.

For narration, write the script first, inspect TTS help, then use its file or stdin input. For music use the music command; spoken podcasts use TTS. For image/video edits pass the actual source using supported input flags. Use the highest useful quality within the user's request; explicit generation requests authorize running them. Do not introduce additional price confirmations.

For photographic 3D, also read `/.agents/skills/photo-to-3d/SKILL.md`. For large images read `/.agents/skills/gigapixel-gemini-mosaic/SKILL.md`, and add the world pack only when selected. Every workflow uses this same official CLI.

Keep expensive inputs, source media and response JSON under `/workspace/.media-work/<run>` or the specialist skill's durable working directory. Dependencies and verbose logs may live under `/tmp`. Deliver user-facing files under `/workspace/output`, create that directory when needed, verify the actual files exist and decode, and report exact sandbox paths. The app handles previews and downloads.

Authentication is provided separately at `/.env`; the launcher reads it. Never print keys, run `printenv`, expose credentials in commands or rewrite authentication. A completed command's real output determines success. For validation/authentication failures stop and report the actual error. Do not silently downgrade models or blindly replay a paid generation after a timeout: inspect a known returned interaction first. Retry a transient operation only when its state is known and duplicate generation is prevented.

Delegate only when authorized: discover `agent --help`, retain the actual returned interaction and environment identifiers, monitor stored background work, and download artifacts with the official environment/file commands. Do not upload a replacement snapshot into an existing environment to add one file; that can destroy its state. Use native code execution or supported inline sources. Only cancel or delete agents created for this task.
