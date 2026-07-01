import sampleCatImageUrl from "../assets/sample-prompts/cat-image.png";
import sampleCatVideoUrl from "../assets/sample-prompts/cat-video.png";
import sampleHackerNewsUrl from "../assets/sample-prompts/hacker-news-podcast.png";
import sampleHtmlAppUrl from "../assets/sample-prompts/html-app.png";
import sampleMusicTrackUrl from "../assets/sample-prompts/music-track.png";
import sampleStoryLabUrl from "../assets/sample-prompts/story-lab.png";
import sampleTranscriptUrl from "../assets/sample-prompts/transcript.png";
import sampleWavMp3Url from "../assets/sample-prompts/wav-mp3.png";

type SamplePrompt = {
  title: string;
  detail: string;
  prompt: string;
  thumbnail: string;
};

const SAMPLE_PROMPTS: SamplePrompt[] = [
  {
    title: "Image",
    detail: "Generate a still visual.",
    thumbnail: sampleCatImageUrl,
    prompt: "Create a cozy square image of a cute cat playing with string in a warm Pacific Northwest home."
  },
  {
    title: "Video",
    detail: "Make a moving scene.",
    thumbnail: sampleCatVideoUrl,
    prompt:
      "Generate a short 16:9 video of a cute cat playing with a ball of yarn in a cozy Pacific Northwest living room, with pine trees visible through the windows."
  },
  {
    title: "Music",
    detail: "Generate a short song.",
    thumbnail: sampleMusicTrackUrl,
    prompt:
      "Create a short upbeat instrumental theme song for a kid-friendly solar system explorer. Make it playful, warm, and a little futuristic."
  },
  {
    title: "TTS",
    detail: "Research, then narrate.",
    thumbnail: sampleHackerNewsUrl,
    prompt:
      "Look at the live Hacker News front page and create a short recap podcast audio file that summarizes the most interesting stories."
  },
  {
    title: "Task",
    detail: "Create audio, then convert it.",
    thumbnail: sampleWavMp3Url,
    prompt:
      "Create a 20-second spoken welcome podcast as a WAV file, then convert it to MP3 and make both files available."
  },
  {
    title: "Transcript",
    detail: "Transcribe a real episode.",
    thumbnail: sampleTranscriptUrl,
    prompt:
      "Go to https://www.gcppodcast.com/post/episode-331-2022-year-end-wrap-up/, find the podcast audio file, and transcribe it."
  },
  {
    title: "Web",
    detail: "Build one HTML app.",
    thumbnail: sampleHtmlAppUrl,
    prompt:
      "Create a kid-friendly animated solar system as one self-contained HTML file. Include the Sun, all eight planets, labels, pause/play, and a speed slider."
  },
  {
    title: "Story App",
    detail: "Image, music, and TTS.",
    thumbnail: sampleStoryLabUrl,
    prompt:
      "Create a simple kid-friendly storybook web app about a tiny island adventure. Generate one hero image, one short instrumental music loop, and one short narrated welcome audio clip, then build a single HTML file that uses those assets with play buttons and a small interactive scene."
  }
];

export const SamplePromptGallery = ({
  disabled,
  onSelect
}: {
  disabled: boolean;
  onSelect: (prompt: string) => void;
}) => (
  <div className="sample-prompts" aria-label="Sample prompts">
    <div className="sample-prompts-head">
      <span>Examples</span>
    </div>
    <div className="sample-prompt-grid">
      {SAMPLE_PROMPTS.map((sample) => (
        <button
          type="button"
          className="sample-prompt"
          disabled={disabled}
          key={sample.title}
          onClick={() => onSelect(sample.prompt)}
        >
          <img src={sample.thumbnail} alt="" aria-hidden="true" />
          <strong>{sample.title}</strong>
          <span>{sample.detail}</span>
        </button>
      ))}
    </div>
  </div>
);
