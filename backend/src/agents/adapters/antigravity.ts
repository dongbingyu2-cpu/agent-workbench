import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentAdapter } from '../types';

function resolveAgyBinary(): string {
  const override = process.env.AW_AGY_CLI?.trim();
  if (override && existsSync(override)) return override;
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const bundled = path.join(local, 'agy', 'bin', 'agy.exe');
    if (existsSync(bundled)) return bundled;
  }
  return 'agy';
}

export const antigravityAdapter: AgentAdapter = {
  kind: 'antigravity',
  displayName: 'Antigravity',
  binaries: ['agy', 'antigravity'],
  supportsResume: true,
  launch: ({ resumeSessionId }) => ({
    file: resolveAgyBinary(),
    args: resumeSessionId ? ['--conversation', resumeSessionId] : [],
  }),
  oneShot: ({ prompt, model, allowWrites }) => ({
    file: resolveAgyBinary(),
    args: [
      '--output-format',
      'text',
      ...(allowWrites ? ['--dangerously-skip-permissions'] : []),
      ...(model ? ['--model', model] : []),
      '--print',
      prompt,
    ],
  }),
};
