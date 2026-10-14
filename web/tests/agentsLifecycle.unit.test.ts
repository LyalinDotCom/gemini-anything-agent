import { beforeEach, expect, test, vi } from 'vitest';
const state = vi.hoisted(() => ({ key: 'test-a', client: null as any }));
vi.mock('../src/gemini/client', () => ({ ai: () => state.client, resolveApiKey: () => state.key }));
import { ensureAgent, ensureManagedAgent, managedAgentId } from '../src/gemini/agents';
import { MODELS } from '../src/models';

beforeEach(() => {
  state.key = 'test-a';
  state.client = { agents: { get: vi.fn().mockRejectedValue({ status: 404 }), create: vi.fn().mockResolvedValue({}), delete: vi.fn() } };
});
test('model variants have stable separate IDs and configure the model at creation', async () => {
  const id = managedAgentId('gai-anything-v1', MODELS.reasoning);
  expect(id).not.toBe('gai-anything-v1');
  expect(managedAgentId(id, MODELS.reasoning)).toBe(id);
  await ensureManagedAgent('gai-anything-v1', null, false, MODELS.reasoning);
  expect(state.client.agents.create.mock.calls[0][0].agent_config).toEqual({ type: 'antigravity', model: MODELS.reasoning });
});
test('a conflict winner with different payload is never reported as healthy', async () => {
  state.client.agents.get.mockRejectedValueOnce({ status: 404 }).mockResolvedValueOnce({ description: 'payload-deadbeef' });
  state.client.agents.create.mockRejectedValue({ status: 409 });
  expect((await ensureAgent('gai-test-conflict', null)).degraded).toBe(true);
});
test('no-key ensure returns a rejected promise rather than throwing synchronously', async () => {
  state.key = '';
  const promise = ensureManagedAgent('gai-test-no-key', null);
  await expect(promise).rejects.toMatchObject({ kind: 'no-key' });
});
test('a key change during lookup cannot send old mounted credentials through the new client', async () => {
  const original = state.client;
  original.agents.get.mockImplementation(async () => {
    state.key = 'test-b';
    state.client = { agents: { create: vi.fn() } };
    throw { status: 404 };
  });
  await ensureAgent('gai-test-key-snapshot', null);
  expect(original.agents.create).toHaveBeenCalledOnce();
  expect(state.client.agents.create).not.toHaveBeenCalled();
});

test('workflow migration tracks credential rotation without storing the plaintext key', async () => {
  const { agentWorkflowFingerprint } = await import('../src/gemini/agents');
  const before = agentWorkflowFingerprint(MODELS.text, 'gai-anything-v1');
  state.key = 'test-b';
  const after = agentWorkflowFingerprint(MODELS.text, 'gai-anything-v1');
  expect(after).not.toBe(before);
  expect(after).not.toContain('test-b');
});

test('an unavailable conflict winner degrades safely instead of throwing an availability error', async () => {
  state.client.agents.get.mockRejectedValueOnce({ status: 404 }).mockRejectedValueOnce({ status: 503 });
  state.client.agents.create.mockRejectedValue({ status: 409 });
  expect((await ensureAgent('gai-test-conflict-outage', null)).degraded).toBe(true);
});
