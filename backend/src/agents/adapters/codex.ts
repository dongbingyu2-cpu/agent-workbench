import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AgentAdapter } from '../types';

function resolveCodexFast(): string {
  const configured = process.env.CODEX_EXECUTABLE?.trim();
  if (configured && existsSync(configured)) return configured;
  const runtime = process.env.CODEX_APP_RUNTIME_CLI_PATH?.trim();
  if (runtime && existsSync(runtime)) return runtime;
  if (process.platform === 'win32') {
    for (const dir of (process.env.PATH || process.env.Path || '').split(';').filter(Boolean)) {
      const exe = path.win32.join(dir, 'codex.exe');
      if (existsSync(exe)) return exe;
      const cmd = path.win32.join(dir, 'codex.cmd');
      if (existsSync(cmd)) return cmd;
    }
  }
  return 'codex';
}

export const codexAdapter: AgentAdapter = {
  kind: 'codex',
  displayName: 'Codex',
  binaries: ['codex'],
  supportsResume: true,
  launch: ({ resumeSessionId }) => ({
    file: 'codex',
    args: resumeSessionId ? ['resume', resumeSessionId] : [],
  }),
  oneShot: ({ prompt, cwd, model, allowWrites }) => ({
    file: resolveCodexFast(),
    args: [
      'exec',
      '--skip-git-repo-check',
      ...(allowWrites ? ['-s', 'workspace-write'] : ['-s', 'read-only']),
      ...(cwd ? ['-C', cwd] : []),
      ...(model ? ['-m', model] : []),
      '-',
    ],
    stdin: prompt,
  }),
};
