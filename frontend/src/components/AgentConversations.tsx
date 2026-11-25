import { useEffect, useState } from 'react';
import type { Client } from '../api';
import type { Agent, SessionEvent, SessionSummary } from '../types';
import { useI18n } from '../lang';

function keyOf(session: SessionSummary): string {
  return `${session.id}|${session.kind}|${session.path ?? ''}`;
}

export function AgentConversations({ client, agent }: { client: Client; agent: Agent }) {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);

  useEffect(() => {
    let alive = true;
    client
      .agentSessions(agent)
      .then((list) => {
        if (!alive) return;
        setSessions(list);
        setActiveKey(list.length ? keyOf(list[0]) : null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [client, agent]);

  const active = sessions.find((s) => keyOf(s) === activeKey) ?? null;

  useEffect(() => {
    if (!active) {
      setEvents([]);
      return;
    }
    let alive = true;
    client
      .sessionEvents(active.id, active.path, active.kind)
      .then((list) => {
        if (alive) setEvents(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [client, active]);

  return (
    <div>
      <ul className="conv-list">
        {sessions.map((session) => (
          <li
            key={keyOf(session)}
            className={`conv-item${keyOf(session) === activeKey ? ' active' : ''}`}
            onClick={() => setActiveKey(keyOf(session))}
          >
            <span className="badge">{session.kind}</span> <span className="mono small">{session.id.slice(0, 8)}</span>
            <div className="conv-title">{session.title}</div>
            <span className="dim small">{session.msgs ?? '—'} msg · {session.project || '—'}</span>
          </li>
        ))}
        {sessions.length === 0 && <li className="empty small">{t('noConversations')}</li>}
      </ul>
      <div className="session-view">
        {events.map((event, index) => (
          <div key={index} className="session-line">
            {event.data}
          </div>
        ))}
      </div>
    </div>
  );
}
