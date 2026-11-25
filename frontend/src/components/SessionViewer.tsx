import { useEffect, useState } from 'react';
import type { Client } from '../api';
import type { SessionEvent } from '../types';

export function SessionViewer({ client, agentId }: { client: Client; agentId: string }) {
  const [events, setEvents] = useState<SessionEvent[]>([]);

  useEffect(() => {
    let alive = true;
    client
      .listSessions(agentId)
      .then((list) => {
        if (alive) setEvents(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [client, agentId]);

  return (
    <div className="session-view">
      {events.map((event, index) => (
        <div key={index} className="session-line">
          {event.data}
        </div>
      ))}
    </div>
  );
}
