import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelSelector } from '../src/components/ModelSelector';
import { HARNESS_MODELS, MODELS } from '../src/models';
import { effectiveRunOptions } from '../src/state/runOptions';
import type { RunOptions } from '../src/state/types';

test.each(HARNESS_MODELS)('selector exposes exactly Flash and Argon and selects $label', model => {
  const html = renderToStaticMarkup(<ModelSelector value={model.id} disabled={false} onChange={() => {}} />);
  expect(html.match(/<option /g)).toHaveLength(2);
  expect(html).toContain(`value="${model.id}" selected=""`);
  expect(html).toContain('aria-label="Reasoning model"');
});
test('unsupported saved model names are normalized to the supported default', () => {
  expect(effectiveRunOptions({runOptions:{agentModel:'retired-model'} as unknown as RunOptions}).agentModel).toBe(MODELS.text);
});
test('valid persisted Argon selection survives session reload defaulting', () => {
  expect(effectiveRunOptions({runOptions:{agentModel:MODELS.reasoning} as RunOptions}).agentModel).toBe(MODELS.reasoning);
});
test('model selection is disabled while a server turn is active', () => {
  expect(renderToStaticMarkup(<ModelSelector value={MODELS.text} disabled onChange={() => {}} />)).toContain('disabled=""');
});
