import { SAMPLE_PROMPTS, type SamplePrompt } from "../lib/samplePrompts";
import { AGENT_MODES } from "./Composer";

export const SamplePromptGallery = ({
  disabled,
  onSelect
}: {
  disabled: boolean;
  onSelect: (sample: SamplePrompt) => void;
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
          onClick={() => onSelect(sample)}
        >
          <img src={sample.thumbnail} alt="" aria-hidden="true" />
          <em className={`sample-prompt-agent ${sample.agentMode}`}>{AGENT_MODES[sample.agentMode].label}</em>
          <strong>{sample.title}</strong>
          <span>{sample.detail}</span>
        </button>
      ))}
    </div>
  </div>
);
