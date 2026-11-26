import path from 'node:path';
import type { Task } from '../agents/types';

export function taskBackground(task: Task): string {
  const round = task.round ?? 1;
  if (round === 1) return task.description;
  const requirements = (task.previousRequirements ?? []).map((text, index) => `Round ${index + 1}: ${text}`);
  const results = task.parts
    .filter((part) => (part.round ?? 1) < round && part.status === 'done')
    .map((part) => `- Round ${part.round ?? 1}, ${part.title}: ${part.resultPath}`);
  return [
    `Current requirement (round ${round}):\n${task.description}`,
    'Continue in the existing workspace. Use earlier work as context and only carry out the current requirement.',
    ...(requirements.length ? ['Earlier requirements:', ...requirements] : []),
    ...(results.length ? ['Earlier results (read the files as needed):', ...results] : []),
  ].join('\n\n');
}

export function taskSummaryPath(task: Task): string {
  const round = task.round ?? 1;
  return path.join(task.workspacePath, round === 1 ? 'SUMMARY.md' : `SUMMARY.round-${round}.md`);
}
