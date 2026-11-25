import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentAdapter } from '../types';

function resolvePiLauncher(): { file: string; prefix: string[] } {
  const launcher = path.join(os.homedir(), '.pi', 'agent', 'bin', 'pi-launcher.js');
  if (existsSync(launcher)) {
    return { file: process.execPath, prefix: [launcher] };
  }
  const cmd = path.join(os.homedir(), '.pi', 'agent', 'bin', 'pi.cmd');
  if (process.platform === 'win32' && existsSync(cmd)) {
    return { file: cmd, prefix: [] };
  }
  return { file: 'pi', prefix: [] };
}

export const piAdapter: AgentAdapter = {
  kind: 'pi',
  displayName: 'pi',
  binaries: ['pi'],
  supportsResume: true,
  launch: ({ resumeSessionId, model, effort }) => ({
    file: 'pi',
    args: [...(resumeSessionId ? ['--session', resumeSessionId] : []), ...(model ? ['--model', model] : []), ...(effort ? ['--thinking', effort] : [])],
  }),
  oneShot: ({ prompt, model }) => {
    const resolved = resolvePiLauncher();
    return {
      file: resolved.file,
      args: [...resolved.prefix, '-p', '--no-session', ...(model ? ['--model', model] : []), prompt],
    };
  },
};
