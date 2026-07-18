// The ONE copy of the sample-prompt gallery data, shared verbatim by the
// Electron and web apps (docs/web-parity.md promises the same ten cards).
// Deliberately import-free so either bundler can consume it; each app maps
// `thumbnailKey` to its own bundled asset URL.
export type SamplePromptAgentMode = "anything" | "browser";

export interface SamplePromptData {
  title: string;
  detail: string;
  prompt: string;
  agentMode: SamplePromptAgentMode;
  thumbnailKey:
    | "cat-image"
    | "cat-video"
    | "music-track"
    | "hacker-news-podcast"
    | "wav-mp3"
    | "transcript"
    | "html-app"
    | "story-lab"
    | "browser-flow"
    | "browser-responsive";
}

export const SAMPLE_PROMPT_DATA: SamplePromptData[] = [
  {
    title: "Image",
    detail: "Generate a still visual.",
    agentMode: "anything",
    thumbnailKey: "cat-image",
    prompt: "Create a cozy square image of a cute cat playing with string in a warm Pacific Northwest home.",
  },
  {
    title: "Video",
    detail: "Make a moving scene.",
    agentMode: "anything",
    thumbnailKey: "cat-video",
    prompt:
      "Generate a short 16:9 video of a cute cat playing with a ball of yarn in a cozy Pacific Northwest living room, with pine trees visible through the windows.",
  },
  {
    title: "Music",
    detail: "Generate a short song.",
    agentMode: "anything",
    thumbnailKey: "music-track",
    prompt:
      "Create a short upbeat instrumental theme song for a kid-friendly solar system explorer. Make it playful, warm, and a little futuristic.",
  },
  {
    title: "TTS",
    detail: "Research, then narrate.",
    agentMode: "anything",
    thumbnailKey: "hacker-news-podcast",
    prompt:
      "Look at the live Hacker News front page and create a short recap podcast audio file that summarizes the most interesting stories.",
  },
  {
    title: "Task",
    detail: "Create audio, then convert it.",
    agentMode: "anything",
    thumbnailKey: "wav-mp3",
    prompt: "Create a 20-second spoken welcome podcast as a WAV file, then convert it to MP3 and make both files available.",
  },
  {
    title: "Transcript",
    detail: "Transcribe a real episode.",
    agentMode: "anything",
    thumbnailKey: "transcript",
    prompt:
      "Go to https://www.gcppodcast.com/post/episode-331-2022-year-end-wrap-up/, find the podcast audio file, and transcribe it.",
  },
  {
    title: "Web",
    detail: "Build one HTML app.",
    agentMode: "anything",
    thumbnailKey: "html-app",
    prompt:
      "Create a kid-friendly animated solar system as one self-contained HTML file. Include the Sun, all eight planets, labels, pause/play, and a speed slider.",
  },
  {
    title: "Story App",
    detail: "Image, music, and TTS.",
    agentMode: "anything",
    thumbnailKey: "story-lab",
    prompt:
      "Create a simple kid-friendly storybook web app about a tiny island adventure. Generate one hero image, one short instrumental music loop, and one short narrated welcome audio clip, then build a single HTML file that uses those assets with play buttons and a small interactive scene.",
  },
  {
    title: "Flow Test",
    detail: "Test an interactive site.",
    agentMode: "browser",
    thumbnailKey: "browser-flow",
    prompt:
      "Use the headless browser to test https://demo.playwright.dev/todomvc/. Add exactly two todos named ‘Buy groceries’ and ‘Water flowers’, mark only ‘Buy groceries’ complete, and verify there are exactly two todos with exactly one completed. Save a full-page screenshot and a concise JSON test report under /workspace/output/browser, inspect browser console errors, then close the browser session and report the evidence paths.",
  },
  {
    title: "Viewport QA",
    detail: "Audit desktop and mobile.",
    agentMode: "browser",
    thumbnailKey: "browser-responsive",
    prompt:
      "Use the headless browser to audit https://playwright.dev/ at desktop 1440×900 and mobile 390×844 viewports. For each viewport, verify the page loads, record the final URL and title, check for horizontal overflow, inspect browser console errors, and save a full-page screenshot. Write a concise Markdown QA report with the checks and evidence paths under /workspace/output/browser, then close every browser session.",
  },
];
