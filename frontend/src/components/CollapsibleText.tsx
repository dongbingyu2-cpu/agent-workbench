import { useState } from 'react';

const DEFAULT_LIMIT = 1200;

export function CollapsibleText({
  text,
  terminal = false,
  className,
  limit = DEFAULT_LIMIT,
}: {
  text: string;
  terminal?: boolean;
  className?: string;
  /** Characters shown before the expand toggle appears. */
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const tooLong = text.length > limit;
  const visible = tooLong && !expanded
    ? terminal ? `…${text.slice(-limit)}` : `${text.slice(0, limit)}…`
    : text;

  const bodyClass = className ?? (terminal ? '' : 'message-body');

  return <>
    {terminal ? <pre className="terminal">{visible}</pre> : bodyClass ? <div className={bodyClass}>{visible}</div> : <>{visible}</>}
    {tooLong && <button className="expand-text" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? '收起' : '展开全文'}</button>}
  </>;
}
