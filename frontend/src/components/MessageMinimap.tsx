import { useEffect, useState } from 'react';

const TICK_HEIGHT = 10;
const MAX_RAIL_HEIGHT = 360;
const RAIL_INSET = 28;

export interface TurnPreview {
  prompt: string;
  reply?: string;
}

function previewText(index: number, turn?: TurnPreview) {
  const [firstLine = '', ...remainingLines] = (turn?.prompt ?? '').trim().split(/\r?\n/);
  const headline = firstLine.trim();
  const title = headline.length > 48 ? `${headline.slice(0, 48)}…` : headline;
  const excerpt = [headline.slice(48), ...remainingLines].join('\n').trim();
  return { title: title || `第 ${index + 1} 条用户消息`, excerpt: (excerpt || turn?.reply || '').slice(0, 360) };
}

export function MessageMinimap({
  targetRef,
  count,
  turns,
}: {
  targetRef: { current: HTMLDivElement | null };
  count: number;
  turns: TurnPreview[];
}) {
  const [ticks, setTicks] = useState<number[]>([]);
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState<number>();
  const [focused, setFocused] = useState<number>();

  useEffect(() => {
    const scroller = targetRef.current;
    if (!scroller) return;
    let frame = 0;
    let samples: HTMLElement[] = [];

    const syncActive = () => {
      const scrollable = scroller.scrollHeight - scroller.clientHeight;
      if (scrollable > 0 && scroller.scrollTop >= scrollable - 1) {
        setActive(Math.max(0, samples.length - 1));
        return;
      }
      const readingLine = scroller.getBoundingClientRect().top + 16;
      let current = 0;
      for (const [index, sample] of samples.entries()) {
        if (sample.getBoundingClientRect().top > readingLine) break;
        current = index;
      }
      setActive(current);
    };

    const measure = () => {
      const messages = scroller.querySelectorAll<HTMLElement>('.message.user');
      const height = scroller.clientHeight || MAX_RAIL_HEIGHT + RAIL_INSET;
      const capacity = Math.max(2, Math.floor(Math.min(MAX_RAIL_HEIGHT, height - RAIL_INSET) / TICK_HEIGHT));
      const size = Math.min(messages.length, capacity);
      // 均匀抽取用户回合，保留首尾并避免长会话把刻度挤在一起。
      const indices = Array.from({ length: size }, (_, index) => Math.round(index * (messages.length - 1) / Math.max(1, size - 1)));
      samples = indices.map((index) => messages[index]);
      setTicks((previous) => previous.length === indices.length && previous.every((value, index) => value === indices[index]) ? previous : indices);
      syncActive();
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        syncActive();
      });
    };

    measure();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(scroller);
    const content = scroller.firstElementChild;
    if (content) observer?.observe(content);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [targetRef, count, turns.length]);

  const dismiss = () => {
    setHovered(undefined);
    setFocused(undefined);
  };

  const jump = (index: number) => {
    dismiss();
    const scroller = targetRef.current;
    const message = scroller?.querySelectorAll<HTMLElement>('.message.user')[index];
    if (!scroller || !message) return;
    const offset = message.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ top: scroller.scrollTop + offset - 14, behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  if (ticks.length < 2) return null;
  const selected = hovered ?? focused;
  const selectedPosition = selected === undefined ? -1 : ticks.indexOf(selected);
  const emphasis = selectedPosition < 0 ? active : selectedPosition;
  const preview = selected !== undefined && selectedPosition >= 0 ? previewText(selected, turns[selected]) : null;

  return (
    <div className="minimap" role="navigation" aria-label="用户对话导航" onMouseLeave={() => setHovered(undefined)}>
      {ticks.map((index, position) => {
        const turn = turns[index];
        const label = turn?.prompt.replace(/\s+/g, ' ').trim().slice(0, 120) || `第 ${index + 1} 条用户消息`;
        return (
          <button
            key={index}
            type="button"
            className="minimap-tick"
            data-distance={Math.min(4, Math.abs(position - emphasis))}
            aria-label={label}
            aria-current={position === active ? 'location' : undefined}
            onMouseEnter={() => setHovered(index)}
            onFocus={() => setFocused(index)}
            onBlur={() => setFocused(undefined)}
            onKeyDown={(event) => { if (event.key === 'Escape') dismiss(); }}
            onClick={() => jump(index)}
          />
        );
      })}
      {preview && (
        <div className="minimap-preview" aria-hidden="true" style={{ top: `clamp(56px, calc(50% + ${(selectedPosition - (ticks.length - 1) / 2) * TICK_HEIGHT}px), calc(100% - 56px))` }}>
          <strong>{preview.title}</strong>
          {preview.excerpt && <span>{preview.excerpt}</span>}
        </div>
      )}
    </div>
  );
}
