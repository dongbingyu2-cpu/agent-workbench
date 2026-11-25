import { useEffect, useState } from 'react';
import type { Client } from '../api';
import type { WorkspaceInfo } from '../types';
import { useI18n } from '../lang';

export function TaskWorkspace({ client, taskId }: { client: Client; taskId: string }) {
  const { t } = useI18n();
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);

  useEffect(() => {
    let alive = true;
    setInfo(null);
    client
      .taskWorkspace(taskId)
      .then((data) => {
        if (alive) setInfo(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [client, taskId]);

  if (!info) return <p className="empty">{t('loading')}</p>;

  return (
    <div>
      <div className="dim small mono" style={{ padding: '8px 12px' }}>
        {info.path}
      </div>
      <ul className="file-list">
        {info.entries.map((entry) => (
          <li key={entry.name} className="file-item">
            {entry.dir ? '▸ ' : '· '}
            {entry.name}
          </li>
        ))}
      </ul>
      {info.shared && <pre className="shared">{info.shared}</pre>}
    </div>
  );
}
