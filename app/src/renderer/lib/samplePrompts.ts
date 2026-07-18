import sampleBrowserFlowUrl from "../assets/sample-prompts/browser-flow.png";
import sampleBrowserResponsiveUrl from "../assets/sample-prompts/browser-responsive.png";
import sampleCatImageUrl from "../assets/sample-prompts/cat-image.png";
import sampleCatVideoUrl from "../assets/sample-prompts/cat-video.png";
import sampleHackerNewsUrl from "../assets/sample-prompts/hacker-news-podcast.png";
import sampleHtmlAppUrl from "../assets/sample-prompts/html-app.png";
import sampleMusicTrackUrl from "../assets/sample-prompts/music-track.png";
import sampleStoryLabUrl from "../assets/sample-prompts/story-lab.png";
import sampleTranscriptUrl from "../assets/sample-prompts/transcript.png";
import sampleWavMp3Url from "../assets/sample-prompts/wav-mp3.png";
import { SAMPLE_PROMPT_DATA, type SamplePromptData } from "./samplePromptData";

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
  "browser-responsive": sampleBrowserResponsiveUrl
};

export const SAMPLE_PROMPTS: SamplePrompt[] = SAMPLE_PROMPT_DATA.map(({ thumbnailKey, ...data }) => ({
  ...data,
  thumbnail: THUMBNAILS[thumbnailKey]
}));
