import type { AgentAdapter } from '../types';

export const claudeAdapter: AgentAdapter = {
  kind: 'claude',
  displayName: 'Claude Code',
  binaries: ['claude'],
  supportsResume: true,
  launch: ({ resumeSessionId, model, effort }) => ({
    file: 'claude',
    args: [...(resumeSessionId ? ['--resume', resumeSessionId] : []), ...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : [])],
  }),
  oneShot: ({ prompt, model, allowWrites }) => ({
    file: 'claude',
    args: ['-p', ...(allowWrites ? ['--dangerously-skip-permissions'] : []), ...(model ? ['--model', model] : []), prompt],
  }),
};
