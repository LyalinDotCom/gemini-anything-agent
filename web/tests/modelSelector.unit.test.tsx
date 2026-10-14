import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelSelector, modelSelectionLocked } from '../src/components/ModelSelector';
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

test('completed, cancelled and failed chats stay locked after streaming and pending clear', () => {
 for (const status of ['complete','stopped','error']) {
  const persisted = JSON.parse(JSON.stringify({messageCount:2,modelUsed:MODELS.reasoning,pending:null,lastInteractionId:'turn-id',status}));
  expect(modelSelectionLocked(persisted, 0)).toBe(true);
 }
 expect(modelSelectionLocked({}, 0)).toBe(false);
 expect(modelSelectionLocked({}, 1)).toBe(true);
});
test('locked selector explains how to change models', () => {
 const html=renderToStaticMarkup(<ModelSelector value={MODELS.reasoning} disabled={false} locked onChange={() => {}} />);
 expect(html).toContain('disabled=""');expect(html).toContain('Start a new chat to choose a different model.');
});
test('pinned model wins over subsequent run-option changes and survives reload', () => {
 const session=JSON.parse(JSON.stringify({modelUsed:MODELS.reasoning,runOptions:{agentModel:MODELS.text}}));
 expect(effectiveRunOptions(session).agentModel).toBe(MODELS.reasoning);
});
