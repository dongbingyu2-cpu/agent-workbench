import { describe, expect, it } from 'vitest';
import { resolveCodexExecutable } from '../src/agents/codexExecutable';

describe('Codex executable discovery', () => {
  it('finds the desktop executable when the workbench PATH does not contain Codex', async () => {
    const executable = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_1\\app\\resources\\codex.exe';
    const result = await resolveCodexExecutable({
      env: { PATH: 'C:\\Windows' },
      platform: 'win32',
      exists: (candidate) => candidate === executable,
      desktopLocations: async () => ['C:\\Program Files\\WindowsApps\\OpenAI.Codex_1'],
    });
    expect(result).toBe(executable);
  });

  it('reports how to configure a missing executable', async () => {
    await expect(resolveCodexExecutable({ env: {}, platform: 'win32', exists: () => false, desktopLocations: async () => [] }))
      .rejects.toThrow(/CODEX_EXECUTABLE/);
  });
});
