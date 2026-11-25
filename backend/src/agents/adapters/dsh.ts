import type { AgentAdapter } from '../types';

/**
 * DeepSeek Harness is a desktop session (stored under ~/.dsh), not a terminal
 * program. It has no CLI to launch, so a task part assigned to it is handled
 * by writing a prompt into the shared workspace instead of spawning a PTY.
 */
export const dshAdapter: AgentAdapter = {
  kind: 'dsh',
  displayName: 'DeepSeek Harness',
  binaries: ['dsh'],
  supportsResume: false,
  launch: () => {
    throw new Error('DeepSeek Harness 是桌面会话，不能通过终端启动');
  },
};
