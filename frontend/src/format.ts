/** Small, dependency-free formatting helpers shared by the session sidebar and viewer. */

export type TimeInput = number | string | null | undefined;

const pad = (value: number): string => String(value).padStart(2, '0');

/** Accepts epoch milliseconds, numeric strings or ISO timestamps. */
export function toMs(value: TimeInput): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** `11:32:52` — the clock stamp shown next to each message. */
export function clockLabel(value: TimeInput): string {
  const ms = toMs(value);
  if (ms === null) return '';
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function isSameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

/** `今天 10:28` / `昨天 09:20` / `11-11 10:21` (year is added when it differs). */
export function relativeDayLabel(value: TimeInput): string {
  const ms = toMs(value);
  if (ms === null) return '';
  const date = new Date(ms);
  const now = new Date();
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (isSameDay(date, now)) return `今天 ${clock}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (isSameDay(date, yesterday)) return `昨天 ${clock}`;
  if (date.getFullYear() === now.getFullYear()) return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `11-11 10:21` — the "started at" chip in the session header. */
export function startLabel(value: TimeInput): string {
  const ms = toMs(value);
  if (ms === null) return '';
  const date = new Date(ms);
  const now = new Date();
  const head = date.getFullYear() === now.getFullYear() ? `${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${head} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `58s` / `5m1s` / `288h01m` — compact elapsed time between two stamps. */
export function durationLabel(start: TimeInput, end: TimeInput): string {
  const from = toMs(start);
  const to = toMs(end);
  if (from === null || to === null || to < from) return '';
  const totalSeconds = Math.round((to - from) / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    const seconds = totalSeconds % 60;
    return seconds ? `${minutes}m${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h${pad(minutes % 60)}m`;
}

/** `988` / `199.6k` / `1.2m` — token counters. */
export function tokenLabel(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  const compact = (scaled: number): string => {
    const rounded = Math.round(scaled * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${compact(value / 1000)}k`;
  return `${compact(value / 1_000_000)}m`;
}

/** Number with thousands separators for tooltips. */
export function countLabel(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US');
}

/** Collapse the home directory to `~` and keep the tail visible in narrow columns. */
export function shortPath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const home = /^([A-Za-z]:)?\/(Users|home)\/[^/]+/.exec(normalized);
  return home ? `~${normalized.slice(home[0].length)}` : normalized;
}

/** Last path segment, for the project group header. */
export function pathTail(value: string): string {
  const normalized = value.replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : value;
}

/** Grouping key: same directory must not split on slash style, case or trailing separators. */
export function projectKey(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return normalized || '__none__';
}

/** Human label for a project group; the user's home directory gets a readable name. */
export function projectLabel(value: string): string {
  if (!value.trim()) return '未知项目';
  const short = shortPath(value).replace(/\/+$/, '');
  return short === '~' ? '~ 主目录' : short;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Agent transcripts escape some characters (`&#x20;`, `&amp;`) before storing them.
 * Decode just the handful that show up in practice instead of injecting raw HTML.
 */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}
