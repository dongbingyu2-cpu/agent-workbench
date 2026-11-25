import type { AgentAdapter } from '../types';

export const workbuddyAdapter: AgentAdapter = {
  kind: 'workbuddy',
  displayName: 'WorkBuddy',
  binaries: ['workbuddy'],
  supportsResume: false,
  launch: () => { throw new Error('WorkBuddy 桌面会话不支持通过终端启动'); },
};
