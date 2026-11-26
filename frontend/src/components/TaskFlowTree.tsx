import { useId, useState } from 'react';
import { statusKey, translate } from '../i18n';
import type { Agent, AgentKind, PartProgress, PartStatus, Task } from '../types';
import { AgentIcon, agentName } from './AgentIcon';
import { CollapsibleText } from './CollapsibleText';

interface FlowPart {
  id: string;
  title: string;
  kind?: AgentKind | null;
  status: PartStatus;
  result?: string;
}

export function TaskFlowTree({ task, agents, progress, drafts, summary }: {
  task: Task;
  agents: Agent[];
  progress: ReadonlyMap<string, PartProgress>;
  drafts: Array<{ title: string; agentId: string }>;
  summary?: string;
}) {
  const listId = useId();
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const currentRound = task.round ?? 1;
  const agentKinds = new Map(agents.map((agent) => [agent.id, agent.kind]));
  const partsByRound = new Map<number, FlowPart[]>();

  // 旧任务的分工没有轮次字段，统一归到第一轮。运行状态以最新进度为准。
  for (const part of task.parts) {
    const number = part.round ?? 1;
    const live = progress.get(part.id);
    const parts = partsByRound.get(number) ?? [];
    parts.push({
      id: part.id,
      title: part.title,
      kind: part.agentKind ?? agentKinds.get(part.assignedAgentId ?? ''),
      status: live?.status ?? part.status,
      result: live?.result,
    });
    partsByRound.set(number, parts);
  }

  const rounds = Array.from({ length: currentRound }, (_, index) => {
    const number = index + 1;
    const isCurrent = number === currentRound;
    const parts = partsByRound.get(number) ?? [];
    const isDraft = isCurrent && task.status === 'planned';
    return {
      number,
      status: isCurrent ? task.status : 'done',
      requirement: isCurrent ? task.description || task.title : task.previousRequirements?.[index],
      parts: isDraft && parts.length === 0
        ? drafts.flatMap((draft, i): FlowPart[] => draft.title.trim() ? [{
          id: `draft-${i}`, title: draft.title.trim(), kind: agentKinds.get(draft.agentId), status: 'proposed',
        }] : [])
        : parts,
      summary: isCurrent ? summary : undefined,
      isDraft,
    };
  });

  return (
    <section className="task-section task-flow" aria-label="协作流程树">
      <ol className="task-flow-rounds">
        {rounds.map(({ number, status, requirement, parts, summary: roundSummary, isDraft }) => {
          const open = expanded[number] ?? (number === currentRound);
          const stagesId = `${listId}-${number}`;
          const results = parts.filter((part) => part.result?.trim());
          return (
            <li className="task-flow-round" key={number}>
              <button
                type="button"
                className="task-flow-toggle"
                aria-expanded={open}
                aria-controls={stagesId}
                onClick={() => setExpanded((previous) => ({ ...previous, [number]: !open }))}
              >
                <span className="task-flow-chevron" aria-hidden="true" />
                <strong>第 {number} 轮</strong>
                <span className={`badge ${status}`}>{translate('zh', statusKey(status))}</span>
              </button>
              <ol className="task-flow-stages" id={stagesId} hidden={!open}>
                {open && <>
                  <li className="task-flow-stage">
                    <h3>需求</h3>
                    {requirement
                      ? <CollapsibleText text={requirement} limit={420} />
                      : <span className="muted small">暂无需求记录</span>}
                  </li>
                  <li className="task-flow-stage">
                    <h3>{isDraft ? '分工方案' : '分工执行'}</h3>
                    {parts.length > 0
                      ? <ul className="task-flow-parts">
                        {parts.map((part) => (
                          <li className="tree-node" key={part.id}>
                            <span className={`tree-dot ${part.status}`} aria-hidden="true" />
                            <span className="tree-title">{part.title}</span>
                            {part.kind && (
                              <span className="source-badge"><AgentIcon kind={part.kind} />{agentName(part.kind)}</span>
                            )}
                            <span className="tree-status">{part.status === 'proposed' ? '待派发' : translate('zh', statusKey(part.status))}</span>
                          </li>
                        ))}
                      </ul>
                      : <span className="muted small">暂无分工</span>}
                  </li>
                  <li className="task-flow-stage">
                    <h3>结果</h3>
                    {results.map((part) => (
                      <details className="part-log-details task-flow-result" key={part.id}>
                        <summary>{part.title}</summary>
                        <CollapsibleText text={part.result!} limit={420} />
                      </details>
                    ))}
                    {roundSummary && (
                      <details className="part-log-details task-flow-result">
                        <summary>Leader 汇总</summary>
                        <CollapsibleText text={roundSummary} limit={420} />
                      </details>
                    )}
                    {results.length === 0 && !roundSummary && <span className="muted small">暂无结果记录</span>}
                  </li>
                </>}
              </ol>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
