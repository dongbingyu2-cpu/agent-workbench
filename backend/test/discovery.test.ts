import { describe, it, expect } from 'vitest';
import { scanProcesses } from '../src/agents/processScanner';
import { Discovery } from '../src/agents/discovery';

const runner = { run: async () => JSON.stringify([{ pid: 10, name: 'claude.exe', cmdline: 'claude --resume abc' }]) };

describe('scanProcesses', () => {
  it('parses powershell JSON output into raw processes', async () => {
    const ps = await scanProcesses(runner, 'win32');
    expect(ps).toEqual([{ pid: 10, name: 'claude.exe', cmdline: 'claude --resume abc' }]);
  });
});

describe('Discovery', () => {
  it('maps running claude to a discovered agent with the session id', async () => {
    const d = new Discovery({ runner, homeDir: 'C:/home', readdir: async () => [] });
    const agents = await d.scanAgents();
    expect(agents[0]).toMatchObject({ kind: 'claude', managed: false, status: 'discovered', sessionId: 'abc' });
  });
});

describe('Discovery dedupe', () => {
  it('collapses helper processes of one agent and skips unrelated processes', async () => {
    const procs = [
      { pid: 1, name: 'node.exe', cmdline: 'node C:/x/@agegr/pi-web/bin/pi-web.js' },
      { pid: 2, name: 'node.exe', cmdline: 'node C:/x/@agegr/pi-web/node_modules/next/dist/bin/next' },
      { pid: 3, name: 'msedgewebview2.exe', cmdline: 'C:/x/Application/157.0/msedgewebview2.exe --embedded' },
      { pid: 4, name: 'ChatGPT.exe', cmdline: 'C:/Program Files/WindowsApps/OpenAI.Codex_26/app/ChatGPT.exe' },
      { pid: 5, name: 'ChatGPT.exe', cmdline: 'C:/Program Files/WindowsApps/OpenAI.Codex_26/app/ChatGPT.exe --type=renderer' },
      { pid: 6, name: 'node.exe', cmdline: 'node C:/x/claude-code/cli.js --resume abc' },
    ];
    const dedupeRunner = { run: async () => JSON.stringify(procs) };
    const d = new Discovery({ runner: dedupeRunner, homeDir: 'C:/home', readdir: async () => [] });
    const agents = await d.scanAgents();
    expect(agents.map((a) => a.kind).sort()).toEqual(['claude', 'codex', 'pi']);
    expect(agents).toHaveLength(3);
  });
});
