import { useState } from 'react';
import type { PartDraft } from '../types';
import { useI18n } from '../lang';

export function SplitPlanDialog({
  drafts,
  onConfirm,
  onCancel,
}: {
  drafts: PartDraft[];
  onConfirm: (drafts: PartDraft[]) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<PartDraft[]>(drafts);

  const update = (index: number, patch: Partial<PartDraft>) => {
    setItems((current) => current.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  return (
    <div className="dialog">
      <div className="dialog-title">{t('proposedSplit')}</div>
      {items.map((draft, index) => (
        <div key={index} className="dialog-row">
          <input className="input" aria-label={`title-${index}`} value={draft.title} onChange={(e) => update(index, { title: e.target.value })} />
          <input
            className="input"
            aria-label={`description-${index}`}
            value={draft.description}
            onChange={(e) => update(index, { description: e.target.value })}
          />
        </div>
      ))}
      <div className="dialog-actions">
        <button className="btn btn-primary" onClick={() => onConfirm(items)}>
          {t('confirm')}
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}
