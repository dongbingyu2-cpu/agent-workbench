import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AgentOpenMode, AgentOpenOption, CatalogModel, CodexModel, SessionSummary } from '../types';
import { AgentIcon, agentName } from './AgentIcon';
import { MessageItem, type MessageRole } from './MessageItem';
import { MessageMinimap, type TurnPreview } from './MessageMinimap';
import { ModelPicker } from './ModelPicker';
import { CollapsibleText } from './CollapsibleText';
import { countLabel, durationLabel, shortPath, startLabel, tokenLabel, type TimeInput } from '../format';

export type MessageTab = 'all' | 'chat' | 'tools';

export interface TimelineEntry {
  role: MessageRole;
  ts: TimeInput;
  text: string;
  name?: string;
}

const TABS: Array<{ key: MessageTab; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'chat', label: '只看对话' },
  { key: 'tools', label: '只看工具' },
];

function metaItems(session: SessionSummary): { key: string; value: string; title?: string }[] {
  const items: { key: string; value: string; title?: string }[] = [];
  const start = startLabel(session.startedAt ?? session.updated);
  if (start) items.push({ key: 'start', value: `${start} 开始` });
  const duration = durationLabel(session.startedAt ?? session.updated, session.updated);
  if (duration) items.push({ key: 'duration', value: `${duration} 时长` });
  if (session.model) items.push({ key: 'model', value: `${session.model} 模型`, title: '本次会话使用的模型' });
  if (session.msgs != null) items.push({ key: 'msgs', value: `${session.msgs} 条消息`, title: `${countLabel(session.msgs)} 条对话消息` });
  if (session.tools) items.push({ key: 'tools', value: `${session.tools} 次工具`, title: `${countLabel(session.tools)} 次工具调用` });
  const tokenIn = tokenLabel(session.tokenIn);
  const tokenOut = tokenLabel(session.tokenOut);
  if (tokenIn || tokenOut) items.push({ key: 'tokens', value: `${tokenIn || '0'} ↑${tokenOut || '0'} tokens`, title: `输入 ${countLabel(session.tokenIn)} / 输出 ${countLabel(session.tokenOut)} tokens` });
  return items;
}

function OpenSessionButtons({ session, onOpen }: { session: SessionSummary; onOpen: (mode?: AgentOpenMode) => void }) {
  const [result, setResult] = useState<{ key: string; options: AgentOpenOption[] }>();
  const key = `${session.kind}:${session.id}`;
  const dual = ['antigravity', 'opencode', 'codex'].includes(session.kind);
  const desktopOrigin = session.antigravityOrigins?.includes('desktop') ? 'desktop' : session.antigravityOrigins?.[0];
  const storage = session.opencodeStorage;
  const desktopBridge = window.workbenchDesktop;
  useEffect(() => {
    if (!dual || !desktopBridge?.openOptions) return;
    const openOptions = desktopBridge.openOptions;
    let revision = 0;
    const refresh = () => {
      const current = ++revision;
      void openOptions(session.kind, { origin: desktopOrigin, opencodeStorage: storage }).then((options) => {
        if (current === revision) setResult({ key, options });
      }).catch(() => {
        if (current === revision) setResult({ key, options: [] });
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      revision += 1;
      window.removeEventListener('focus', refresh);
    };
  }, [desktopBridge, desktopOrigin, dual, key, storage, session.kind]);

  const options = result?.key === key ? result.options : [];
  if (options.length) {
    return (
      <div className="open-mode-buttons" role="group" aria-label={`打开 ${agentName(session.kind)} 会话`}>
        {options.map(({ mode, available }) => {
          const importNeeded = mode === 'cli' && desktopOrigin === 'desktop' && !session.antigravityOrigins?.includes('cli');
          const label = mode === 'desktop' ? 'Desktop' : importNeeded ? 'CLI 导入' : 'CLI';
          const hint = !available ? mode === 'desktop' && desktopOrigin === 'cli' ? '这条会话只在 CLI 中' : `未检测到 ${mode === 'desktop' ? 'Desktop' : 'CLI'}`
            : mode === 'desktop' ? '在桌面端定位这条会话'
            : importNeeded ? '打开 CLI，从 /resume 导入桌面会话'
            : '续接指定会话';
          return <button key={mode} type="button" className={`btn ${mode === 'cli' ? 'btn-primary' : 'btn-ghost'}`} disabled={!available} onClick={() => onOpen(mode)} title={hint}>{label}</button>;
        })}
      </div>
    );
  }
  return (
    <button type="button" className="btn btn-primary" onClick={() => onOpen()} disabled={session.kind === 'generic' || (dual && Boolean(desktopBridge?.openOptions) && result?.key !== key)} title={session.kind === 'dsh' ? '打开 DeepSeek Harness，并定位到此会话' : '在原客户端打开此会话'}>
      {agentName(session.kind)}
    </button>
  );
}

export function SessionDetail({
  session,
  entries,
  loading,
  tab,
  onTab,
  connected,
  connecting,
  onRetry,
  output,
  input,
  onInput,
  onSend,
  onInterrupt,
  onOpenAgent,
  onDelete,
  running = false,
  models = [], cliModels = [], modelsError = '', modelsLoading = false, onRefreshModels, model = '', effort = '', onChoice, onApply,
}: {
  session: SessionSummary;
  entries: TimelineEntry[];
  loading: boolean;
  tab: MessageTab;
  onTab: (tab: MessageTab) => void;
  connected: boolean;
  connecting: boolean;
  onRetry: () => void;
  output: string;
  input: string;
  onInput: (value: string) => void;
  onSend: () => void;
  onInterrupt: () => void;
  onOpenAgent?: (mode?: AgentOpenMode) => void;
  onDelete?: () => void;
  running?: boolean;
  models?: CodexModel[];
  cliModels?: CatalogModel[];
  modelsError?: string;
  modelsLoading?: boolean;
  onRefreshModels?: () => void;
  model?: string;
  effort?: string;
  onChoice?: (choice: { model: string; effort: string }) => void;
  onApply?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const readOnly = session.kind === 'workbuddy' || session.kind === 'dsh' || session.kind === 'antigravity';
  const codex = session.kind === 'codex';
  const cliSelectable = ['claude', 'opencode', 'pi'].includes(session.kind);
  const nearBottom = useRef(false);
  const [showJump, setShowJump] = useState(false);
  const previous = useRef({ kind: session.kind, id: session.id, tab, output });
  const measureBottom = (node: HTMLDivElement) => {
    const distance = node.scrollHeight - node.clientHeight - node.scrollTop;
    nearBottom.current = distance <= 24;
    // Only offer the shortcut once the reader is clearly above the newest message.
    setShowJump(distance > 160);
  };
  const jumpToBottom = () => {
    const node = scrollRef.current;
    if (!node) return;
    if (typeof node.scrollTo === 'function') node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
    else node.scrollTop = node.scrollHeight;
  };
  const chatCount = entries.filter((entry) => entry.role !== 'tool').length;
  const toolCount = entries.length - chatCount;
  const visible = tab === 'tools' ? toolCount : tab === 'chat' ? chatCount : entries.length;
  const shown = tab === 'tools' ? entries.filter((entry) => entry.role === 'tool') : tab === 'chat' ? entries.filter((entry) => entry.role !== 'tool') : entries;
  const turns: TurnPreview[] = [];
  for (const entry of shown) {
    if (entry.role === 'user') {
      turns.push({ prompt: entry.text });
    } else if (entry.role === 'assistant') {
      const turn = turns.at(-1);
      if (turn && !turn.reply) turn.reply = entry.text;
    }
  }

  // 用输出增长前的位置判断是否跟随；切换会话或筛选时重新测量。
  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const last = previous.current;
    if (last.kind === session.kind && last.id === session.id && last.tab === tab && last.output !== output && output && nearBottom.current) {
      node.scrollTop = node.scrollHeight;
    }
    measureBottom(node);
    previous.current = { kind: session.kind, id: session.id, tab, output };
  });

  return (
    <div className="session-detail">
      <header className="content-head">
        <div className="head-title-row">
          <div className="head-title">
            <h1>{session.title}</h1>
            <div className="head-path" title={session.project}>{shortPath(session.project) || '未知项目'}</div>
          </div>
          <div className="head-actions">
            {onDelete && (
              <button
                type="button"
                className="btn btn-danger-ghost"
                onClick={onDelete}
                title="删除此会话（移入设置中的回收站，不删除原数据）"
              >
                删除
              </button>
            )}
            {onOpenAgent && <OpenSessionButtons session={session} onOpen={onOpenAgent} />}
            {false && !readOnly && (
              <>
                <span className={`conn${connected ? ' live' : ''}`} title={connected ? '实时连接已建立' : '实时连接未建立'}>
                  <span className="status-dot" aria-hidden="true" />
                  {connected ? '实时' : '离线'}
                </span>
                <button type="button" className="btn btn-primary" disabled={connected || connecting} onClick={onRetry}>
                  {connecting ? '正在续接…' : connected ? '已接入' : '重试续接'}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="meta">
          <span className="kind-chip">
            <AgentIcon kind={session.kind} />
            {agentName(session.kind)}
          </span>
          {readOnly && <span>{session.antigravityOrigins?.map((origin) => origin === 'cli' ? 'CLI' : '桌面').join(' / ') || '桌面'}会话 · 只读</span>}
          {codex && <span>Codex Desktop 会话</span>}
          {metaItems(session).map((item) => (
            <span key={item.key} title={item.title}>
              {item.value}
            </span>
          ))}
        </div>
      </header>

      <div className="tabs-row">
        <div className="tabs" role="tablist" aria-label="消息筛选">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              className={tab === item.key ? 'chosen' : ''}
              onClick={() => onTab(item.key)}
            >
              {item.label}
              <span className="tab-count">{item.key === 'all' ? entries.length : item.key === 'tools' ? toolCount : chatCount}</span>
            </button>
          ))}
        </div>
        <div className="tabs-count">
          显示 {visible} / {entries.length} 条
        </div>
      </div>

      <div className="notice">会话在工作台中只读浏览，请在对应客户端中继续。</div>

      <div className="conversation-wrap">
        <div className="conversation" ref={scrollRef} onScroll={(event) => measureBottom(event.currentTarget)}>
          <div className="conversation-inner">
          {loading && entries.length === 0 && (
            <div className="message-skeletons" aria-hidden="true">
              {[0, 1, 2].map((row) => (
                <div key={row} className="message-skeleton">
                  <span className="skeleton-line" />
                  <span className="skeleton-line wide" />
                </div>
              ))}
            </div>
          )}
          {!loading && shown.length === 0 && <div className="empty padded">{entries.length === 0 ? '该会话没有可显示的记录。' : '当前筛选下没有内容。'}</div>}
          {shown.map((entry, index) => (
            <MessageItem key={`${entry.role}-${index}`} role={entry.role} ts={entry.ts} text={entry.text} name={entry.name} />
          ))}
          {false && !readOnly && output && (
            <article className="message system">
              <div className="message-head">
                <span className="role-tag system">实时终端</span>
                <span className="spacer" />
              </div>
              <CollapsibleText text={output} terminal />
            </article>
          )}
          </div>
        </div>
        {showJump && (
          <button type="button" className="jump-bottom" onClick={jumpToBottom} aria-label="跳到最新消息" title="跳到最新消息">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5.5v13M6.2 12.7 12 18.5l5.8-5.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <MessageMinimap key={`${session.kind}:${session.id}:${tab}`} targetRef={scrollRef} count={shown.length} turns={turns} />
      </div>

      {false && !readOnly && (
        <div className="composer">
          <div className="composer-card">
            <textarea
              value={input}
              onChange={(event) => onInput(event.target.value)}
              placeholder={connected ? `和 ${codex ? 'Codex' : agentName(session.kind)} 一起工作` : '续接会话后即可输入'}
              disabled={!connected}
              aria-label="发送到会话"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (connected && input.trim()) onSend();
                }
              }}
            />
            <div className="composer-bar">
              <span className="spacer" />
              {(codex || cliSelectable) && (
                <ModelPicker
                  kind={session.kind}
                  models={models}
                  cliModels={cliModels}
                  modelsError={modelsError}
                  modelsLoading={modelsLoading}
                  onRefreshModels={onRefreshModels}
                  model={model}
                  effort={effort}
                  onChange={(next) => onChoice?.(next)}
                  onApply={cliSelectable ? onApply : undefined}
                  applying={connecting}
                  contextUsed={session.contextTokens}
                  contextTotal={session.contextWindow}
                />
              )}
              {running && !input.trim() ? (
                <button
                  type="button"
                  className="send-btn running"
                  onClick={onInterrupt}
                  aria-label="暂停"
                  title={codex ? '暂停当前 Codex 任务' : '中断当前任务（Ctrl+C）'}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="7" y="7" width="10" height="10" rx="2.4" fill="currentColor" />
                  </svg>
                </button>
              ) : (
                <button type="button" className="send-btn" disabled={!connected || !input.trim()} onClick={onSend} aria-label="发送" title="发送（Enter 发送，Shift+Enter 换行）">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 19V5.5M6.2 11.3 12 5.5l5.8 5.8" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
