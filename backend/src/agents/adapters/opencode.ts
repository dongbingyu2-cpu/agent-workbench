import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AgentAdapter } from '../types';

function resolveOpenCodeBinary(): string {
  if (process.platform === 'win32') {
    const candidates = [
      process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe') : '',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'pnpm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe') : '',
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return 'opencode';
}

export const opencodeAdapter: AgentAdapter = {
  kind: 'opencode',
  displayName: 'opencode',
  binaries: ['opencode'],
  supportsResume: true,
  launch: ({ resumeSessionId, model }) => ({
    file: 'opencode',
    args: [...(resumeSessionId ? ['--session', resumeSessionId] : []), ...(model ? ['--model', model] : [])],
  }),
  oneShot: ({ prompt, model }) => ({
    file: resolveOpenCodeBinary(),
    args: ['run', ...(model ? ['--model', model] : []), prompt],
  }),
};
