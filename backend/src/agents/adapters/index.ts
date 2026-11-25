import { registerAdapter } from '../registry';
import type { AgentAdapter } from '../types';
import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';
import { opencodeAdapter } from './opencode';
import { piAdapter } from './pi';
import { workbuddyAdapter } from './workbuddy';
import { dshAdapter } from './dsh';
import { antigravityAdapter } from './antigravity';
import { genericAdapter } from './generic';
const all: AgentAdapter[] = [
  claudeAdapter,
  codexAdapter,
  opencodeAdapter,
  piAdapter,
  workbuddyAdapter,
  dshAdapter,
  antigravityAdapter,
  genericAdapter,
];

export function registerAdapters(): void {
  for (const adapter of all) registerAdapter(adapter);
}
