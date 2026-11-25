import { useEffect, useState } from 'react';
import type { Client } from '../api';
import type { Agent, PartDraft, Task } from '../types';
import { statusKey } from '../i18n';
import { useI18n } from '../lang';
import { PartProgress } from './PartProgress';
import { SplitPlanDialog } from './SplitPlanDialog';

export function TaskBoard({
  client,
  agent,
  activeTaskId,
  onSelectTask,
}: {
  client: Client;
  agent?: Agent;
  activeTaskId?: string | null;
  onSelectTask?: (id: string) => void;
}) {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [planFor, setPlanFor] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<PartDraft[] | null>(null);
  const [localActive, setLocalActive] = useState<string | null>(null);

  const current = activeTaskId ?? localActive;

  const refresh = () => {
    client
      .listTasks()
      .then(setTasks)
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
  }, [client]);

  const create = async () => {
    await client.createTask(title, description);
    setTitle('');
    setDescription('');
    refresh();
  };

  const requestPlan = async (taskId: string) => {
    if (!agent) return;
    const result = await client.plan(taskId, agent);
    setPlanFor(taskId);
    setDrafts(result);
  };

  const setActiveTask = (id: string) => {
    setLocalActive(id);
    onSelectTask?.(id);
  };

  const confirmPlan = async (edited: PartDraft[]) => {
    if (!agent || !planFor) return;
    await client.confirm(
      planFor,
      edited.map((d) => ({ title: d.title, description: d.description, agent })),
    );
    setDrafts(null);
    setActiveTask(planFor);
    setPlanFor(null);
    refresh();
  };

  return (
    <div>
      <div className="task-form">
        <input className="input" placeholder={t('taskTitle')} value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="input" placeholder={t('description')} value={description} onChange={(e) => setDescription(e.target.value)} />
        <button className="btn btn-primary" onClick={() => void create()}>
          {t('create')}
        </button>
      </div>

      <ul className="task-list">
        {tasks.map((task) => (
          <li key={task.id} className={`task-item${current === task.id ? ' active' : ''}`}>
            <div className="task-row">
              <span className="task-title" onClick={() => setActiveTask(task.id)}>
                {task.title}
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className={`badge ${task.status}`}>{t(statusKey(task.status))}</span>
                <button className="btn btn-ghost" disabled={!agent} onClick={() => void requestPlan(task.id)}>
                  {t('plan')}
                </button>
              </div>
            </div>
            {current === task.id && <PartProgress client={client} taskId={task.id} />}
          </li>
        ))}
      </ul>

      {drafts && (
        <SplitPlanDialog
          drafts={drafts}
          onConfirm={(edited) => void confirmPlan(edited)}
          onCancel={() => {
            setDrafts(null);
            setPlanFor(null);
          }}
        />
      )}
    </div>
  );
}
