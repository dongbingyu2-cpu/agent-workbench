import type { AgentAdapter } from '../types';

export const genericAdapter: AgentAdapter = {
  kind: 'generic',
  displayName: 'Generic CLI agent',
  binaries: [],
  supportsResume: false,
  launch: () => ({ file: 'sh', args: [] }),
};
