import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AgentKind, CatalogModel, CodexModel } from '../types';
import { tokenLabel } from '../format';

const EFFORT_LABELS: Record<string, string> = {
  none: '无',
  off: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
  ultra: '极致',
};

export function effortLabel(value: string): string {
  return EFFORT_LABELS[value] ?? value;
}

function CheckMark() {
  return (
    <svg className="model-check" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5 9.6 17 19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Context usage ring: how full the model's window already is for this session. */
function ContextRing({ ratio, label }: { ratio: number | null; label: string }) {
  const radius = 5;
  const circumference = 2 * Math.PI * radius;
  const value = ratio ?? 0;
  const critical = value >= 0.85;
  return (
    <svg className="context-ring" viewBox="0 0 14 14" role="img" aria-label={label}>
      <title>{label}</title>
      <circle cx="7" cy="7" r={radius} fill="none" stroke="var(--border-strong)" strokeWidth="1.6" />
      {value > 0.02 && (
        <circle
          cx="7"
          cy="7"
          r={radius}
          fill="none"
          stroke={critical ? 'var(--warn)' : 'var(--accent)'}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray={`${value * circumference} ${circumference}`}
          transform="rotate(-90 7 7)"
        />
      )}
    </svg>
  );
}

const CLI_EFFORTS: Partial<Record<AgentKind, string[]>> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  pi: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
};

/** Discrete reasoning-effort slider: dots mark the levels, the thumb sits on the current one. */
function EffortSlider({ levels, value, onChange }: { levels: string[]; value: string; onChange: (level: string) => void }) {
  const max = levels.length - 1;
  if (max < 1) return null;
  const current = Math.max(0, levels.indexOf(value));
  return (
    <div className="effort-slider" style={{ '--ratio': current / max } as CSSProperties}>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={current}
        onChange={(event) => onChange(levels[Number(event.target.value)])}
        aria-label="思考强度"
        aria-valuetext={effortLabel(value)}
      />
      <div className="effort-dots" aria-hidden="true">
        {levels.map((level, index) => (
          <span
            key={level}
            className={`effort-dot${index <= current ? ' filled' : ''}`}
            style={{ left: `${(index / max) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Compact model / effort picker that sits in the composer bar.
 * Codex models come from the app-server; CLI agents take a free-text model name.
 */
export function ModelPicker({
  kind,
  models,
  cliModels = [],
  modelsError = '',
  modelsLoading = false,
  onRefreshModels,
  model,
  effort,
  onChange,
  onApply,
  applying = false,
  contextUsed,
  contextTotal,
}: {
  kind: AgentKind;
  models: CodexModel[];
  cliModels?: CatalogModel[];
  modelsError?: string;
  modelsLoading?: boolean;
  onRefreshModels?: () => void;
  model: string;
  effort: string;
  onChange: (next: { model: string; effort: string }) => void;
  onApply?: () => void;
  applying?: boolean;
  contextUsed?: number | null;
  contextTotal?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const codex = kind === 'codex';
  const selectedModel = models.find((item) => item.model === model);
  const effortOptions = codex ? selectedModel?.supportedReasoningEfforts.map((item) => item.reasoningEffort) ?? [] : CLI_EFFORTS[kind] ?? [];
  const cliLabel = model ? cliModels.find((item) => item.id === model)?.label ?? model : '沿用会话模型';
  const name = codex ? selectedModel?.displayName ?? (model || '沿用会话模型') : cliLabel;
  // A model that is not in the catalogue means the user typed it by hand.
  const customActive = !codex && (custom || (model !== '' && !cliModels.some((item) => item.id === model)));
  // Without an explicit pick Codex uses the model's default effort; showing it keeps the chip honest.
  const effortValue = codex ? effort || (selectedModel?.defaultReasoningEffort ?? '') : effort;
  const contextRatio = typeof contextUsed === 'number' && typeof contextTotal === 'number' && contextTotal > 0
    ? Math.max(0, Math.min(1, contextUsed / contextTotal))
    : null;
  const contextText = contextRatio === null
    ? ''
    : `上下文 ${tokenLabel(contextUsed)} / ${tokenLabel(contextTotal)}（${Math.round(contextRatio * 100)}%）`;

  useEffect(() => {
    if (!open) return;
    // Bring the current model into view instead of always starting at the top.
    const active = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (active && typeof active.scrollIntoView === 'function') active.scrollIntoView({ block: 'nearest' });
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        type="button"
        className="model-trigger"
        onClick={() => {
          const next = !open;
          setOpen(next);
          // Opening with an empty list means the earlier read failed or never ran.
          if (next) {
            if (codex && models.length === 0) onRefreshModels?.();
            if (!codex && cliModels.length === 0) onRefreshModels?.();
          }
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="模型与思考强度"
        title={modelsError || `${contextText ? `${contextText} · ` : ''}选择模型与思考强度`}
      >
        <ContextRing ratio={contextRatio} label={contextText || '上下文用量未知'} />
        <span className="model-name">{name}</span>
        {effortValue && <span className="model-effort">{effortLabel(effortValue)}</span>}
      </button>

      {open && (
        <div className="model-popover" role="dialog" aria-label="模型设置">
          <div className="popover-section-title">
            <span>模型</span>
            <span className="section-actions">
              {!codex && (
                <button type="button" className="section-action" onClick={() => setCustom(true)}>
                  自定义
                </button>
              )}
              {onRefreshModels && (
                <button type="button" className="section-action" onClick={onRefreshModels} disabled={modelsLoading}>
                  {modelsLoading ? '读取中…' : '刷新'}
                </button>
              )}
            </span>
          </div>
          {codex ? (
            <>
              <div className="model-list" role="listbox" aria-label="模型" ref={listRef}>
                <button
                  type="button"
                  role="option"
                  aria-selected={!model}
                  className="model-option"
                  onClick={() => onChange({ model: '', effort: '' })}
                >
                  <span className="model-option-name">沿用会话模型</span>
                  {!model && <CheckMark />}
                </button>
                {models.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={model === item.model}
                    className="model-option"
                    onClick={() => onChange({ model: item.model, effort: '' })}
                    title={item.description}
                  >
                    <span className="model-option-name">{item.displayName}</span>
                    {model === item.model && <CheckMark />}
                  </button>
                ))}
              </div>
              {modelsLoading && models.length === 0 && <p className="popover-hint">正在读取模型列表…</p>}
              {!modelsLoading && modelsError && (
                <p className="popover-note">
                  {modelsError}
                  {onRefreshModels && (
                    <button type="button" className="section-action" onClick={onRefreshModels}>
                      重试
                    </button>
                  )}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="model-list" role="listbox" aria-label="模型">
                <button
                  type="button"
                  role="option"
                  aria-selected={!customActive && !model}
                  className="model-option"
                  onClick={() => {
                    setCustom(false);
                    onChange({ model: '', effort });
                  }}
                >
                  <span className="model-option-name">沿用会话模型</span>
                  {!customActive && !model && <CheckMark />}
                </button>
                {cliModels.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={!customActive && model === item.id}
                    className="model-option"
                    onClick={() => {
                      setCustom(false);
                      onChange({ model: item.id, effort });
                    }}
                    title={item.id}
                  >
                    <span className="model-option-name">{item.label}</span>
                    {!customActive && model === item.id && <CheckMark />}
                  </button>
                ))}
                <button
                  type="button"
                  role="option"
                  aria-selected={customActive}
                  className="model-option"
                  onClick={() => setCustom(true)}
                >
                  <span className="model-option-name">自定义模型…</span>
                  {customActive && <CheckMark />}
                </button>
              </div>
              {modelsLoading && cliModels.length === 0 && <p className="popover-hint">正在读取模型列表…</p>}
              {!modelsLoading && modelsError && (
                <p className="popover-note">
                  {modelsError}
                  {onRefreshModels && (
                    <button type="button" className="section-action" onClick={onRefreshModels}>
                      重试
                    </button>
                  )}
                </p>
              )}
              {customActive && (
                <input
                  className="input"
                  value={model}
                  onChange={(event) => onChange({ model: event.target.value, effort })}
                  placeholder={kind === 'opencode' ? 'provider/model，留空沿用' : '模型名称，留空沿用'}
                  aria-label="模型名称"
                />
              )}
            </>
          )}

          {effortOptions.length > 0 ? (
            <>
              <div className="popover-section-title">
                <span>思考强度</span>
                <span className="effort-current">{effortLabel(effortValue || effortOptions[0])}</span>
              </div>
              <EffortSlider levels={effortOptions} value={effort || effortValue || effortOptions[0]} onChange={(level) => onChange({ model, effort: level })} />
            </>
          ) : (
            codex && !model && <p className="popover-hint">选择具体模型后可调整思考强度</p>
          )}

          {onApply && (
            <button
              type="button"
              className="btn btn-primary popover-apply"
              onClick={() => {
                onApply();
                setOpen(false);
              }}
              disabled={applying}
            >
              应用并重连
            </button>
          )}
        </div>
      )}
    </div>
  );
}
