// Gallery data comes from the ONE shared module (docs/web-parity.md promises the
// Electron and web galleries stay identical); only the asset URLs are per-bundler.
import sampleBrowserFlowUrl from "../../app/src/renderer/assets/sample-prompts/browser-flow.png";
import sampleBrowserResponsiveUrl from "../../app/src/renderer/assets/sample-prompts/browser-responsive.png";
import sampleCatImageUrl from "../../app/src/renderer/assets/sample-prompts/cat-image.png";
import sampleCatVideoUrl from "../../app/src/renderer/assets/sample-prompts/cat-video.png";
import sampleHackerNewsUrl from "../../app/src/renderer/assets/sample-prompts/hacker-news-podcast.png";
import sampleHtmlAppUrl from "../../app/src/renderer/assets/sample-prompts/html-app.png";
import sampleMusicTrackUrl from "../../app/src/renderer/assets/sample-prompts/music-track.png";
import sampleStoryLabUrl from "../../app/src/renderer/assets/sample-prompts/story-lab.png";
import sampleTranscriptUrl from "../../app/src/renderer/assets/sample-prompts/transcript.png";
import sampleWavMp3Url from "../../app/src/renderer/assets/sample-prompts/wav-mp3.png";
import {
  SAMPLE_PROMPT_DATA,
  type SamplePromptData,
} from "../../app/src/renderer/lib/samplePromptData";

export type SamplePrompt = Omit<SamplePromptData, "thumbnailKey"> & { thumbnail: string };

const THUMBNAILS: Record<SamplePromptData["thumbnailKey"], string> = {
  "cat-image": sampleCatImageUrl,
  "cat-video": sampleCatVideoUrl,
  "music-track": sampleMusicTrackUrl,
  "hacker-news-podcast": sampleHackerNewsUrl,
  "wav-mp3": sampleWavMp3Url,
  transcript: sampleTranscriptUrl,
  "html-app": sampleHtmlAppUrl,
  "story-lab": sampleStoryLabUrl,
  "browser-flow": sampleBrowserFlowUrl,
  "browser-responsive": sampleBrowserResponsiveUrl,
};

export const SAMPLE_PROMPTS: SamplePrompt[] = SAMPLE_PROMPT_DATA.map(({ thumbnailKey, ...data }) => ({
  ...data,
  thumbnail: THUMBNAILS[thumbnailKey],
}));
