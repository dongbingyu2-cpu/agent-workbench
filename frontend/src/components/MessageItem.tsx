import { useState } from 'react';
import { CollapsibleText } from './CollapsibleText';
import { clockLabel, type TimeInput } from '../format';

export type MessageRole = 'user' | 'assistant' | 'tool';

const ROLE_LABEL: Record<MessageRole, string> = { user: '用户', assistant: 'AI', tool: '工具' };

/**
 * One timeline entry. User turns get a tinted bubble, assistant turns read as
 * plain prose, tool calls collapse into a compact monospace card.
 */
export function MessageItem({ role, ts, text, name }: { role: MessageRole; ts: TimeInput; text: string; name?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (e.g. insecure context) — stay silent */
    }
  };

  return (
    <article className={`message ${role}`}>
      <div className="message-head">
        <span className={`role-tag ${role}`}>{ROLE_LABEL[role]}</span>
        {role === 'tool' && name && <span className="tool-name">{name}</span>}
        <span className="msg-time">{clockLabel(ts)}</span>
        <span className="spacer" />
        <button type="button" className="copy-btn" onClick={() => void copy()} aria-label="复制消息内容">
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <CollapsibleText text={text} className={role === 'tool' ? 'tool-output' : 'message-body'} limit={role === 'tool' ? 120 : undefined} />
    </article>
  );
}
