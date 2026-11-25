import type { AgentAdapter, AgentKind } from './types';
import type { RawProcess } from './processScanner';

export interface ProcessMatch {
  kind: AgentKind;
  key: string;
  sessionId?: string;
}

/** Split a path component into lowercased word pieces (codex, pi-web, OpenAI.Codex_26). */
function pieces(component: string): string[] {
  return component.toLowerCase().split(/[._\-]/).filter(Boolean);
}

function matchName(name: string, binary: string): string | null {
  const base = name.toLowerCase().replace(/\.exe$/i, '');
  return pieces(base).includes(binary) ? base : null;
}

function matchPath(token: string, binary: string): string | null {
  const clean = token.replace(/^["']+|["']+$/g, '').replace(/[.,;:]+$/, '');
  const components = clean.split(/[\\/]/);
  for (let i = 0; i < components.length; i++) {
    if (pieces(components[i]).includes(binary)) {
      return components.slice(0, i + 1).join('/').toLowerCase();
    }
  }
  return null;
}

export function extractSessionId(cmdline: string): string | undefined {
  const m = cmdline.match(/--resume\s+["']?([^"'\s]+)/);
  return m ? m[1] : undefined;
}

/**
 * Match a raw process to an adapter. A process only matches when the binary name
 * is a whole word piece of the executable name or of a path component — not an
 * arbitrary substring (so "pi" no longer matches "application", and "codex" no
 * longer matches every ChatGPT renderer unless its path really is a Codex folder).
 */
export function matchProcess(proc: RawProcess, adapters: AgentAdapter[]): ProcessMatch | null {
  const tokens = proc.cmdline.split(/\s+/).filter((t) => t.includes('/') || t.includes('\\'));
  const sessionId = extractSessionId(proc.cmdline);
  for (const adapter of adapters) {
    for (const binary of adapter.binaries) {
      const byName = matchName(proc.name, binary);
      if (byName) return { kind: adapter.kind, key: byName, sessionId };
      for (const token of tokens) {
        const byPath = matchPath(token, binary);
        if (byPath) return { kind: adapter.kind, key: byPath, sessionId };
      }
    }
  }
  return null;
}
