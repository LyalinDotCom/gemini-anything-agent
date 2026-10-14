import { expect, test } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import { browserApiFetch, resolveApiKey } from '../src/gemini/client';
import { buildInteractionParams, tools } from '../src/gemini/interactionParams';
import { buildEnvSources } from '../src/gemini/envSources';
import { HARNESS_MODELS, MODELS } from '../src/models';
import { listOutputFiles, downloadOutputFile } from '../src/gemini/envFiles';

const enabled = process.env.BASELINE_MODELS_LIVE === '1';
const root = '../outputs/baseline-models';
const delay = () => new Promise(resolve => setTimeout(resolve, 2000));

test.skipIf(!enabled)('baseline harness completes stored runs with both exclusively supported models', async () => {
  mkdirSync(root, { recursive: true });
  const records = await Promise.all(HARNESS_MODELS.map(async model => {
    const sent: unknown[] = [];
    const client = new GoogleGenAI({ apiKey: resolveApiKey()!, httpOptions: { retryOptions: { attempts: 1 }, fetch: async (input, init) => {
      const text = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : '';
      if (text) {
        const request = JSON.parse(text);
        if (request.agent_config) sent.push(request.agent_config);
      }
      return browserApiFetch(input, init);
    } } });
    const filename = `${model.id}.txt`;
    const body = buildInteractionParams({ agent: MODELS.chatAgentBase, agentModel: model.id,
      input: `Baseline harness live test. Use one code_execution call to compute 6*7 and save the answer 42 to /workspace/output/${filename}. Do not generate media or inspect other files. Finish immediately.`,
      seedSources: buildEnvSources(resolveApiKey()!), toolset: [tools.codeExecution], store: true, background: true, stream: false });
    let result = await client.interactions.create(body as never, { maxRetries: 0 }) as unknown as Record<string, any>;
    const id = result.id;
    writeFileSync(`${root}/${model.id}-run.json`, JSON.stringify({ id, model: model.id, agent_config: body.agent_config }));
    const deadline = Date.now() + 180_000;
    while (['running','in_progress','pending','queued'].includes(result.status) && Date.now() < deadline) {
      await delay(); result = await client.interactions.get(id) as unknown as Record<string, any>;
    }
    expect(result.status, model.id).toBe('completed');
    expect(sent).toContainEqual({ type: 'antigravity', model: model.id });
    const environmentId = result.environment_id;
    expect(environmentId).toBeTruthy();
    const files = await listOutputFiles(environmentId);
    const file = files.find(file => file.path.endsWith(filename)); expect(file).toBeTruthy();
    const output = await downloadOutputFile(environmentId, file!);
    expect(new TextDecoder().decode(output.data).trim()).toBe('42');
    return { requested_model: model.id, sent_config: sent, returned_config: result.agent_config, status: result.status, interaction_id: id, environment_id: environmentId };
  }));
  writeFileSync(root+'/models.json', JSON.stringify(records, null, 2));
}, 240_000);

test.skipIf(!enabled)('probe medium and high thinking levels against the actual managed-agent endpoint', async () => {
  mkdirSync(root, { recursive: true });
  const records = [];
  for (const level of ['medium','high']) {
    const sent: unknown[] = [];
    const client = new GoogleGenAI({ apiKey: resolveApiKey()!, httpOptions: { retryOptions: { attempts: 1 }, fetch: async (input, init) => {
      const text = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : '';
      if (text) sent.push(JSON.parse(text).agent_config);
      return browserApiFetch(input, init);
    } } });
    const body = buildInteractionParams({ agent: MODELS.chatAgentBase, agentModel: MODELS.reasoning, input: 'Reply exactly OK. Use no tools.', stream: false, store: true });
    body.agent_config = { ...(body.agent_config as object), thinking_level: level };
    try {
      const result = await client.interactions.create(body as never, { maxRetries: 0 }) as unknown as Record<string, unknown>;
      records.push({ level, sent, accepted: true, returned_config: result.agent_config, status: result.status, interaction_id: result.id });
    } catch (error) {
      const e = error as { status?: number; message?: string };
      records.push({ level, sent, accepted: false, status: e.status, message: e.message?.replaceAll(resolveApiKey()!, '[REDACTED]') });
    }
  }
  writeFileSync(root+'/thinking-level-probe.json', JSON.stringify(records, null, 2));
  expect(records).toHaveLength(2);
  for (const record of records) { expect(record.accepted).toBe(false); expect(record.status).toBe(400); expect(record.sent).toContainEqual({type:'antigravity',model:MODELS.reasoning,thinking_level:record.level}); }
}, 180_000);
