import { useEffect, useState } from 'react';
import type { Client } from '../api';
import type { Agent, WorkspaceInfo } from '../types';
import { statusKey } from '../i18n';
import { useI18n } from '../lang';

export function AgentList({ client, onSelect }: { client: Client; onSelect?: (agent: Agent) => void }) {
  const { t } = useI18n();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Record<string, WorkspaceInfo>>({});

  useEffect(() => {
    let alive = true;
    client
      .listAgents()
      .then((list) => {
        if (alive) setAgents(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [client]);

  const toggle = async (agent: Agent) => {
    onSelect?.(agent);
    if (expanded === agent.id) {
      setExpanded(null);
      return;
    }
    setExpanded(agent.id);
    if (!workspaces[agent.id]) {
      try {
        const info = await client.agentWorkspace(agent);
        setWorkspaces((map) => ({ ...map, [agent.id]: info }));
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <ul className="agent-list">
      {agents.map((agent) => (
        <li key={agent.id} className={`agent-item${expanded === agent.id ? ' expanded' : ''}`}>
          <div className="agent-row" onClick={() => void toggle(agent)}>
            <span className={`dot ${agent.status}`} aria-hidden="true" />
            <span className="agent-name">{agent.name}</span>
            <span className="badge">{agent.kind}</span>
            <span className="spacer" />
            <span className="agent-chevron" aria-hidden="true">
              {expanded === agent.id ? '▾' : '▸'}
            </span>
          </div>
          <div className="agent-meta">
            {t(statusKey(agent.status))}
            {agent.sessionId ? ` · ${agent.sessionId}` : ''}
          </div>
          <div className="agent-actions">
            <button
              className="btn"
              disabled={!agent.sessionId}
              onClick={(e) => {
                e.stopPropagation();
                void client.adopt(agent.id, agent);
              }}
            >
              {t('adopt')}
            </button>
            <button
              className="btn btn-ghost"
              onClick={(e) => {
                e.stopPropagation();
                void client.release(agent.id);
              }}
            >
              {t('release')}
            </button>
          </div>

          {expanded === agent.id && (
            <div className="agent-workspace">
              <div className="dim small mono">{workspaces[agent.id]?.path ?? agent.cwd ?? ''}</div>
              {workspaces[agent.id] ? (
                <ul className="file-list">
                  {workspaces[agent.id].entries.map((entry) => (
                    <li key={entry.name} className="file-item">
                      {entry.dir ? '▸ ' : '· '}
                      {entry.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="empty small">{t('loading')}</div>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
