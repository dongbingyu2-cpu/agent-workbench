import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listAgentModels } from '../src/agents/modelCatalog';

function home(): string {
  return mkdtempSync(join(tmpdir(), 'models-'));
}

describe('agent model catalogue', () => {
  it('reads claude models from the settings capabilities string, deduped and sorted', async () => {
    const dir = home();
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(
      join(dir, '.claude', 'settings.json'),
      JSON.stringify({ env: { CLAUDE_CODE_MODEL_CAPABILITIES: 'zhiduapi/b=effort;zhiduapi/a=effort,max;zhiduapi/b=max' } }),
    );
    const models = await listAgentModels('claude', { homeDir: dir });
    expect(models.map((model) => model.id)).toEqual(['zhiduapi/a', 'zhiduapi/b']);
  });

  it('merges the pi model store with user-added provider models', async () => {
    const dir = home();
    mkdirSync(join(dir, '.pi', 'agent'), { recursive: true });
    writeFileSync(
      join(dir, '.pi', 'agent', 'models-store.json'),
      JSON.stringify({ 'opencode-go': { models: [{ id: 'beam-free', name: 'Beam Free', provider: 'opencode-go' }] } }),
    );
    writeFileSync(
      join(dir, '.pi', 'agent', 'models.json'),
      JSON.stringify({ providers: { magpie: { models: [{ id: 'auto/deepseek', name: 'DeepSeek (auto)' }] } } }),
    );
    const models = await listAgentModels('pi', { homeDir: dir });
    // Store ids are bare (prefix with provider); config ids may already carry a slash.
    expect(models.map((model) => model.id)).toEqual(['opencode-go/beam-free', 'auto/deepseek']);
    expect(models[0].label).toBe('Beam Free · opencode-go');
  });

  it('returns an empty catalogue instead of throwing when nothing is configured', async () => {
    await expect(listAgentModels('claude', { homeDir: home() })).resolves.toEqual([]);
  });
});
