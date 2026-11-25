import type { AgentKind } from '../types';

const names: Record<AgentKind, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  opencode: 'OpenCode',
  workbuddy: 'WorkBuddy',
  dsh: 'DeepSeek Harness',
  antigravity: 'Antigravity',
  pi: 'pi',
  generic: 'Agent',
};

export function agentName(kind: AgentKind): string {
  return names[kind];
}

/**
 * Vector fallbacks for agents without a bitmap logo. Drawn in a 24×24 viewBox so
 * they scale cleanly from the 13px badge inside a session card up to the 34px
 * source filter — a fixed font-size glyph used to overflow and get clipped.
 */
function PiMark() {
  return (
    <svg viewBox="0 0 24 24" role="presentation" focusable="false" aria-hidden="true">
      <path
        d="M4.6 8.5h14.8M9.3 8.5v9.6M14.7 8.5v9.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GenericMark() {
  return (
    <svg viewBox="0 0 24 24" role="presentation" focusable="false" aria-hidden="true">
      <text x="12" y="16.8" textAnchor="middle" fontSize="10" fontWeight="700" fill="currentColor">
        Ag
      </text>
    </svg>
  );
}

export function AgentIcon({ kind }: { kind: AgentKind }) {
  if (kind === 'antigravity') {
    return (
      <span className="agent-icon agent-icon-antigravity" aria-hidden="true">
        <svg viewBox="0 0 24 24" role="presentation" focusable="false">
          <path d="M4 17 9 8a3.5 3.5 0 0 1 4-1" fill="none" stroke="#4285f4" strokeWidth="3" strokeLinecap="round" />
          <path d="M13 7c2 1 4 6 7 10" fill="none" stroke="#ea4335" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  if (kind === 'pi') {
    return (
      <span className="agent-icon agent-icon-pi" aria-hidden="true">
        <PiMark />
      </span>
    );
  }
  if (kind === 'generic') {
    return (
      <span className="agent-icon agent-icon-generic" aria-hidden="true">
        <GenericMark />
      </span>
    );
  }
  return <img className="agent-icon" src={`/agents/${kind}.png`} alt="" />;
}
