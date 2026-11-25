import { describe, it, expect } from 'vitest';
import { matchProcess } from '../src/agents/matcher';
import { registerAdapters } from '../src/agents/adapters/index';
import { listAdapters } from '../src/agents/registry';

registerAdapters();
const adapters = listAdapters();

describe('matchProcess', () => {
  it('matches a node script under claude-code and reads --resume', () => {
    const m = matchProcess({ pid: 1, name: 'node.exe', cmdline: 'node C:/x/claude-code/cli.js --resume abc' }, adapters);
    expect(m).toMatchObject({ kind: 'claude', sessionId: 'abc' });
  });

  it('matches the Codex desktop app via its OpenAI.Codex folder', () => {
    const m = matchProcess({ pid: 2, name: 'ChatGPT.exe', cmdline: 'C:/Program Files/WindowsApps/OpenAI.Codex_26/app/ChatGPT.exe' }, adapters);
    expect(m?.kind).toBe('codex');
  });

  it('does not match a bare word in a shell command', () => {
    const m = matchProcess({ pid: 3, name: 'bash.exe', cmdline: 'bash.exe -c "echo claude"' }, adapters);
    expect(m).toBeNull();
  });

  it('does not match an unrelated webview process', () => {
    const m = matchProcess({ pid: 4, name: 'msedgewebview2.exe', cmdline: 'C:/x/Application/157.0/msedgewebview2.exe --embedded' }, adapters);
    expect(m).toBeNull();
  });

  it('matches a pi-web node script', () => {
    const m = matchProcess({ pid: 5, name: 'node.exe', cmdline: 'node C:/x/@agegr/pi-web/bin/pi-web.js' }, adapters);
    expect(m?.kind).toBe('pi');
  });
});
