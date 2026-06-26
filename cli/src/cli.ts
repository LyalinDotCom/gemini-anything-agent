#!/usr/bin/env node

import { Command } from "commander";
import { loadEnvironment } from "./config.js";
import { printResult } from "./output.js";
import { runDoctor } from "./subcommands/doctor.js";
import { runImage } from "./subcommands/image.js";
import { listModels } from "./subcommands/models.js";
import { runTranscribe } from "./subcommands/transcribe.js";
import { runTts } from "./subcommands/tts.js";
import { runVideo } from "./subcommands/video.js";
import type { CommandFailure } from "./types.js";

loadEnvironment();

const program = new Command();

const packageVersion = "0.1.4";

const failureFromError = (error: unknown, capability?: string, model?: string): CommandFailure => ({
  ok: false,
  capability,
  model,
  error: {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    details:
      typeof error === "object" && error && "details" in error
        ? (error as { details?: unknown }).details
        : undefined
  }
});

const runAction = async (
  json: boolean | undefined,
  action: () => Promise<unknown> | unknown,
  capability?: string
): Promise<void> => {
  try {
    const result = await action();
    printResult(result, Boolean(json));
  } catch (error) {
    const failure = failureFromError(error, capability);
    if (json) {
      printResult(failure, true);
    } else {
      process.stderr.write(`${failure.error.name}: ${failure.error.message}\n`);
    }
    process.exitCode = 1;
  }
};

program
  .name("gai")
  .description("Gemini Anything media capability CLI for managed agents")
  .version(packageVersion)
  .addHelpText(
    "after",
    `

Run a command help page before using a media capability:
  gai image --help
  gai video --help
  gai tts --help
  gai transcribe --help

Use --json for machine-readable output. Generated files are written to --out when provided.`
  );

program
  .command("models")
  .description("Print the wrapped model registry")
  .option("--json", "print machine-readable JSON")
  .action((options: { json?: boolean }) => {
    const result = listModels();
    printResult(result, Boolean(options.json));
  });

program
  .command("doctor")
  .description("Validate local environment for media generation")
  .option("--json", "print machine-readable JSON")
  .action((options: { json?: boolean }) => runAction(options.json, runDoctor, "doctor"));

program
  .command("image")
  .description("Generate or edit an image")
  .argument("<prompt>", "image prompt")
  .option("--out <path>", "output file path")
  .option("--aspect <ratio>", "aspect ratio", "1:1")
  .option("--image-size <size>", "image size, e.g. 512, 1K, 2K, 4K", "1K")
  .option("--mime <mime>", "output MIME type", "image/jpeg")
  .option("--model <model>", "override model")
  .option("--file <path...>", "reference image file(s)")
  .option("--dry-run", "show selected model and output path without calling the API")
  .option("--json", "print machine-readable JSON")
  .addHelpText(
    "after",
    `

Examples:
  gai image "a crisp app icon" --out /workspace/output/icon.jpg --json
  gai image "turn this into a watercolor" --file input.jpg --out /workspace/output/edit.jpg --json`
  )
  .action((prompt: string, options) => runAction(options.json, () => runImage(prompt, options), "image"));

program
  .command("tts")
  .description("Generate text-to-speech audio")
  .argument("[prompt]", "speech prompt or script. Optional when --script-file is provided")
  .option("--out <path>", "output file path")
  .option("--voice <voice>", "prebuilt voice name", "Kore")
  .option("--speaker <speaker>", "speaker name for multi-speaker prompts")
  .option("--language <language>", "language code")
  .option("--script-file <path>", "read script text from a file")
  .option("--mime <mime>", "output MIME type", "audio/wav")
  .option("--model <model>", "override model")
  .option("--dry-run", "show selected model and output path without calling the API")
  .option("--json", "print machine-readable JSON")
  .addHelpText(
    "after",
    `

Examples:
  gai tts "Say cheerfully: hello" --voice Puck --out /workspace/output/hello.wav --json
  gai tts --script-file /workspace/output/script.txt --voice Puck --out /workspace/output/podcast.wav --json`
  )
  .action((prompt: string | undefined, options) => runAction(options.json, () => runTts(prompt, options), "tts"));

program
  .command("transcribe")
  .description("Transcribe an audio file")
  .argument("<file>", "audio file path")
  .option("--out <path>", "output transcript path")
  .option("--model <model>", "override model")
  .option("--prompt <text>", "additional transcription instructions")
  .option("--language <language>", "expected language or locale")
  .option("--format <format>", "markdown, text, srt, or json", "markdown")
  .option("--no-speakers", "do not request speaker labels")
  .option("--no-timestamps", "do not request timestamps")
  .option("--mime <mime>", "input audio MIME type override")
  .option("--dry-run", "show selected model and output path without calling the API")
  .option("--json", "print machine-readable JSON")
  .addHelpText(
    "after",
    `

Examples:
  gai transcribe /workspace/output/podcast.wav --out /workspace/output/podcast-transcript.md --json
  gai transcribe meeting.mp3 --format srt --out captions.srt --json`
  )
  .action((file: string, options) =>
    runAction(options.json, () => runTranscribe(file, options), "transcribe")
  );

program
  .command("video")
  .description("Generate a video")
  .argument("<prompt>", "video prompt")
  .option("--out <path>", "output file path")
  .option("--quality <quality>", "lite, premium, or fast-premium", "lite")
  .option("--aspect <ratio>", "aspect ratio", "16:9")
  .option("--resolution <resolution>", "720p, 1080p, or supported model resolution")
  .option("--duration <seconds>", "duration in seconds", "8")
  .option("--poll-interval <seconds>", "poll interval in seconds", "10")
  .option("--timeout <seconds>", "timeout in seconds", "900")
  .option("--dry-run", "show selected model and output path without calling the API")
  .option("--json", "print machine-readable JSON")
  .addHelpText(
    "after",
    `

Examples:
  gai video "a cute cat playing with string in a cozy home" --quality lite --out /workspace/output/cat.mp4 --json
  gai video "slow camera move over a product" --aspect 9:16 --duration 8 --out /workspace/output/clip.mp4 --json`
  )
  .action((prompt: string, options) => runAction(options.json, () => runVideo(prompt, options), "video"));

await program.parseAsync(process.argv);
