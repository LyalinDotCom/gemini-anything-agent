#!/usr/bin/env node

import { Command } from "commander";
import { loadEnvironment } from "./config.js";
import { printResult } from "./output.js";
import {
  runAgentCancel,
  runAgentCreate,
  runAgentDelete,
  runAgentDeleteInteraction,
  runAgentGet,
  runAgentList,
  runAgentLs,
  runAgentPull,
  runAgentRun,
  runAgentStatus
} from "./subcommands/agent.js";
import { runDoctor } from "./subcommands/doctor.js";
import { runImage } from "./subcommands/image.js";
import { listModels } from "./subcommands/models.js";
import { runMusic } from "./subcommands/music.js";
import { runTranscribe } from "./subcommands/transcribe.js";
import { runTts } from "./subcommands/tts.js";
import { runVideo } from "./subcommands/video.js";
import type { CommandFailure } from "./types.js";

loadEnvironment();

const program = new Command();

const packageVersion = "0.2.0";

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
  .description("Gemini Anything CLI: media capabilities plus managed-agent creation and control")
  .version(packageVersion)
  .addHelpText(
    "after",
    `

Run a command help page before using a capability:
  gai image --help
  gai video --help
  gai tts --help
  gai music --help
  gai transcribe --help
  gai agent --help

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
  .command("music")
  .description("Generate a short music track")
  .argument("<prompt>", "music prompt")
  .option("--out <path>", "output MP3 file path")
  .option("--style <text>", "style, genre, mood, instrumentation, or production direction")
  .option("--lyrics <text>", "lyrics or lyrical concept")
  .option("--lyrics-file <path>", "read lyrics from a text file")
  .option("--instrumental", "request instrumental music without vocals")
  .option("--negative <text>", "things to avoid")
  .option("--model <model>", "override model")
  .option("--dry-run", "show selected model and output path without calling the API")
  .option("--json", "print machine-readable JSON")
  .addHelpText(
    "after",
    `

Examples:
  gai music "uplifting synthwave theme for a product demo" --out /workspace/output/theme.mp3 --json
  gai music "cozy acoustic loop for a kid-friendly solar system app" --style "warm, playful, instrumental" --instrumental --out /workspace/output/solar-theme.mp3 --json`
  )
  .action((prompt: string, options) => runAction(options.json, () => runMusic(prompt, options), "music"));

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

const agent = program
  .command("agent")
  .description("Create, run, and manage Gemini managed agents")
  .addHelpText(
    "after",
    `

Examples:
  gai agent create researcher --description "web research helper" --tool google_search --json
  gai agent run researcher "Summarize today's top AI news" --json
  gai agent run builder "Build the report" --background --json
  gai agent status <interaction-id> --wait --json
  gai agent ls --interaction <interaction-id> --json
  gai agent pull --interaction <interaction-id> --extract ./artifacts --json`
  );

agent
  .command("create")
  .description("Create a managed agent")
  .argument("<id>", "agent id (unique within the project)")
  .option("--base <base-agent>", "base agent id")
  .option("--description <text>", "agent description")
  .option("--system <text>", "durable system instruction")
  .option("--system-file <path>", "read the system instruction from a file")
  .option("--tool <tool...>", "enable tool(s): code_execution, google_search, url_context")
  .option("--dry-run", "show the agent definition without calling the API")
  .option("--json", "print machine-readable JSON")
  .action((id: string, options) => runAction(options.json, () => runAgentCreate(id, options), "agent"));

agent
  .command("list")
  .description("List managed agents")
  .option("--json", "print machine-readable JSON")
  .action((options: { json?: boolean }) => runAction(options.json, runAgentList, "agent"));

agent
  .command("get")
  .description("Show one managed agent")
  .argument("<id>", "agent id")
  .option("--json", "print machine-readable JSON")
  .action((id: string, options) => runAction(options.json, () => runAgentGet(id), "agent"));

agent
  .command("delete")
  .description("Delete a managed agent")
  .argument("<id>", "agent id")
  .option("--json", "print machine-readable JSON")
  .action((id: string, options) => runAction(options.json, () => runAgentDelete(id), "agent"));

agent
  .command("run")
  .description("Start an interaction with an agent (waits for the result by default)")
  .argument("<agent>", "agent id (custom or base agent)")
  .argument("[input]", "task prompt. Optional when --input-file is provided")
  .option("--input-file <path>", "read the task prompt from a file")
  .option("--env <environment>", "environment: 'remote' or an existing environment id", "remote")
  .option("--previous <interaction-id>", "continue from a previous interaction")
  .option("--system <text>", "request-level system instruction (replaces the agent's)")
  .option("--system-file <path>", "read the request-level system instruction from a file")
  .option("--background", "return immediately after starting; check with 'gai agent status'")
  .option("--out <path>", "write the final output text to a file")
  .option("--poll-interval <seconds>", "poll interval while waiting", "10")
  .option("--timeout <seconds>", "max seconds to wait for completion", "1800")
  .option("--dry-run", "show the interaction request without calling the API")
  .option("--json", "print machine-readable JSON")
  .action((agentId: string, input: string | undefined, options) =>
    runAction(options.json, () => runAgentRun(agentId, input, options), "agent")
  );

agent
  .command("status")
  .description("Check an interaction; --wait polls until it finishes")
  .argument("<interaction-id>", "interaction id")
  .option("--wait", "poll until the interaction reaches a terminal status")
  .option("--out <path>", "with --wait, write the final output text to a file")
  .option("--poll-interval <seconds>", "poll interval while waiting", "10")
  .option("--timeout <seconds>", "max seconds to wait for completion", "1800")
  .option("--json", "print machine-readable JSON")
  .action((interactionId: string, options) =>
    runAction(options.json, () => runAgentStatus(interactionId, options), "agent")
  );

agent
  .command("cancel")
  .description("Cancel a running interaction")
  .argument("<interaction-id>", "interaction id")
  .option("--json", "print machine-readable JSON")
  .action((interactionId: string, options) =>
    runAction(options.json, () => runAgentCancel(interactionId), "agent")
  );

agent
  .command("delete-interaction")
  .description("Delete a stored interaction")
  .argument("<interaction-id>", "interaction id")
  .option("--json", "print machine-readable JSON")
  .action((interactionId: string, options) =>
    runAction(options.json, () => runAgentDeleteInteraction(interactionId), "agent")
  );

agent
  .command("ls")
  .description("List files in an agent environment snapshot")
  .argument("[environment-id]", "environment id. Optional when --interaction is provided")
  .option("--interaction <interaction-id>", "resolve the environment from an interaction")
  .option("--json", "print machine-readable JSON")
  .action((environmentId: string | undefined, options) =>
    runAction(options.json, () => runAgentLs(environmentId, options), "agent")
  );

agent
  .command("pull")
  .description("Download an agent environment snapshot (the container's files)")
  .argument("[environment-id]", "environment id. Optional when --interaction is provided")
  .option("--interaction <interaction-id>", "resolve the environment from an interaction")
  .option("--out <path>", "output tar path")
  .option("--extract <dir>", "also extract the snapshot into a directory")
  .option("--dry-run", "show the download plan without calling the API")
  .option("--json", "print machine-readable JSON")
  .action((environmentId: string | undefined, options) =>
    runAction(options.json, () => runAgentPull(environmentId, options), "agent")
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
