import { useEffect, useState } from 'react';
import type { Client } from '../api';
import type { PartProgress as PartProgressData } from '../types';
import { statusKey } from '../i18n';
import { useI18n } from '../lang';

export function PartProgress({ client, taskId }: { client: Client; taskId: string }) {
  const { t } = useI18n();
  const [parts, setParts] = useState<PartProgressData[]>([]);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      client
        .progress(taskId)
        .then((list) => {
          if (alive) setParts(list);
        })
        .catch(() => {});
    };
    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [client, taskId]);

  return (
    <ul className="progress-list">
      {parts.map((part) => (
        <li key={part.partId} className="progress-item">
          <div className="progress-head">
            <span className={`dot ${part.status}`} aria-hidden="true" />
            <span className={`badge ${part.status}`}>{t(statusKey(part.status))}</span>
            <span className="dim small mono">{part.partId.slice(0, 8)}</span>
          </div>
          {part.tail && <div className="progress-tail">{part.tail.slice(-400)}</div>}
        </li>
      ))}
    </ul>
  );
}
