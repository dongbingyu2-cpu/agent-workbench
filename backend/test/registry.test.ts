import { describe, it, expect } from 'vitest';
import { registerAdapters } from '../src/agents/adapters/index';
import { getAdapter, listAdapters } from '../src/agents/registry';

describe('adapter registry', () => {
  registerAdapters();
  it('resolves claude with a resume launch command', () => {
    const a = getAdapter('claude');
    expect(a.binaries).toContain('claude');
    const cmd = a.launch({ resumeSessionId: 'abc', cwd: 'C:/x' });
    expect(cmd.file).toBe('claude');
    expect(cmd.args).toContain('--resume');
    expect(cmd.args).toContain('abc');
  });
  it('falls back to generic for unknown kinds', () => {
    const a = getAdapter('mystery' as any);
    expect(a.kind).toBe('generic');
  });
  it('lists every supported kind', () => {
    const kinds = listAdapters().map((a) => a.kind);
    for (const k of ['claude', 'codex', 'opencode', 'pi', 'workbuddy', 'generic']) expect(kinds).toContain(k);
  });
  it('passes model and supported reasoning settings to CLI resume commands', () => {
    expect(getAdapter('claude').launch({ cwd: 'C:/x', resumeSessionId: 'abc', model: 'sonnet', effort: 'high' }).args)
      .toEqual(['--resume', 'abc', '--model', 'sonnet', '--effort', 'high']);
    expect(getAdapter('opencode').launch({ cwd: 'C:/x', resumeSessionId: 'abc', model: 'provider/model' }).args)
      .toEqual(['--session', 'abc', '--model', 'provider/model']);
    expect(getAdapter('pi').launch({ cwd: 'C:/x', resumeSessionId: 'abc', model: 'provider/model', effort: 'high' }).args)
      .toEqual(['--session', 'abc', '--model', 'provider/model', '--thinking', 'high']);
  });
});
