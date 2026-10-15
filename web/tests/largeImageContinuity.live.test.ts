import { expect, test } from 'vitest';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ai } from '../src/gemini/client';
import { ensureManagedAgent } from '../src/gemini/agents';
import { buildInteractionParams } from '../src/gemini/interactionParams';
import { asEventStream, blocksFromInteraction, consumeInteractionStream } from '../src/gemini/streamAdapter';
import { downloadOutputFile, listOutputFiles } from '../src/gemini/envFiles';
import { LARGE_IMAGE_INVOCATION } from '../../shared/largeImageProfile';

test.skipIf(process.env.LARGE_IMAGE_CONTINUITY_LIVE !== '1')('container preserves the explicit image model and shared render contract across adjoining regions', async () => {
  const root = '../outputs/large-image-continuity-v2'; mkdirSync(root, { recursive: true });
  const resume = process.env.CONTINUITY_RESUME === '1' ? JSON.parse(readFileSync(root + '/run.json', 'utf8')) : undefined;
  const agentId = resume?.agentId ?? `test-gaa-continuity-${Date.now()}`;
  if (!resume) await ensureManagedAgent(agentId, null);
  const prompt = `Authorized bounded image continuity regression test. Read BOTH mounted large-image and dr-seuss-world skills and the world rules through code execution. Use ONLY official bash /.agents/bin/gemini-api for model calls INSIDE this managed Linux agent. Discover version and image help once; explicitly pass gemini-nano-banana-2.1 for EVERY image generation, record exact commands without credentials and raw JSON responses. Native Python only processes artifacts.
Create a SMALLER TEST, not the full49-region example: canvas4500x1536, grid2x1, TWO adjoining native2K16:9 regions. Use /workspace/.large-image-work/continuity for durable work. Write a fresh world_plan.json with image_model, render_contract(camera,subject_scale,regional_detail,composition), macro_map_prompt, style, style_rules and two distinct connected districts. Follow the world skill's constant elevated camera, scale and continuous warm daylight. One colourful riverside town, connected turquoise river and continuous striped railway, inhabitants and varied original buildings with expressive faces. No giant foreground landmarks or separate lighting zones. The macro_map_prompt MUST request ONLY distant terrain, rivers, colour zones and small distant building placeholders: no title, banner, lettering, labels, inhabitants or giant buildings. Region prompts must invent the detailed town within that geographic guide. Do not read helper implementations; discover their help only. Call native mosaic.py master-request to obtain the master prompt/model, generate that exact request at4K, inspect the actual master. Generate first two neighbours in order using native reference request JSON EXACT prompts/model/ref/tier/aspect. Save RAW CLI JSON as responses/resp_rR_cC.json; returned JPEG is losslessly converted to tile PNG, never upscale or stretch. Inspect actual first pair for blur, perspective/scale mismatch and seam discontinuities before continuing. Do not claim numeric tests prove visual quality. This test ends with TWO regions, not four or49; at most ONE targeted edit on a concretely failed region, no speculative retries. Save honest preflight report.
In EVERY code call obtain PY through bash /.agents/bin/large-image-setup and run native operation in SAME call. Build TWO existing tiles using native helper bounded checkpoints, then separate final encoding invocation. Run qa.py and make_deepzoom.py. Run finish.py with BOTH skills to deliver under /workspace/output/large-images/continuity. Save master-request.json, the TWO request JSONs, raw responses, CLI version and non-secret executed generation commands to output too, plus a copy of master preview and original tiles for primary visual review. Save tile requested_model/actual_dimensions/hash separately if response omits model; do not invent response model. Finish after delivery; no full49 grid. This test changes request construction and camera consistency, not native compositor algorithms.`;
  const response = resume ? undefined : await ai().interactions.create(buildInteractionParams({ agent: agentId, input: prompt, systemInstruction: LARGE_IMAGE_INVOCATION, store: true, background: true, stream: true }) as never, { maxRetries: 0, timeout_ms: 25 * 60_000 } as never);
  let id = resume?.interactionId ?? '', env = resume?.environmentId ?? '';
  let outcome;
  try {
    if (response) outcome = await consumeInteractionStream(asEventStream(response), (blocks, meta) => {
      id = meta.interactionId || id; env = meta.environmentId || env;
      writeFileSync(root + '/run.json', JSON.stringify({ agentId, interactionId: id, environmentId: env }));
      writeFileSync(root + '/progress.json', JSON.stringify({ blocks, meta }));
    }, { stallMs: 30_000 });
  } catch (error) { if (!id) throw error; }
  while (!outcome || ['running','in_progress','pending','queued'].includes(outcome.status)) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    outcome = blocksFromInteraction(await ai().interactions.get(id) as Record<string, unknown>);
    writeFileSync(root + '/progress.json', JSON.stringify(outcome));
  }
  writeFileSync(root + '/outcome.json', JSON.stringify(outcome));
  expect(outcome.status).toBe('completed'); env = outcome.environmentId || env;
  const files = await listOutputFiles(env);
  for (const file of files.filter(f => f.path.includes('/large-images/continuity/'))) {
    const entry = await downloadOutputFile(env, file);
    writeFileSync(root + '/' + file.path.split('/large-images/continuity/')[1].replaceAll('/', '-'), entry.data);
  }
  const json = (name: string) => {
    const path = readdirSync(root).find(file => file === name || file.endsWith("-" + name));
    if (!path) throw new Error("Missing delivered metadata: " + name);
    return JSON.parse(readFileSync(root + "/" + path, "utf8"));
  };
  const validation = json('validation.json');
  expect(validation.size).toEqual([4500, 1536]); expect(validation.generated_regions).toBe(2);
  expect(validation.cli_responses).toHaveLength(2); expect(validation.cli_version).toContain('0.4.2');
  const master = json('master-request.json'); expect(master.model).toBe('gemini-nano-banana-2.1');
  for (const [r,c] of [[0,0],[0,1]]) {
    const request = json(`request_r${r}_c${c}.json`);
    expect(request.model).toBe(master.model); expect(request.render_contract).toEqual(master.render_contract);
    expect(request.expected_size).toEqual([2752,1536]);
  }
}, 35 * 60_000);
