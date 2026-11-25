export interface CommandRunner {
  run(file: string, args: string[]): Promise<string>;
}

export interface RawProcess {
  pid: number;
  name: string;
  cmdline: string;
}

const WIN_COMMAND = [
  '-NoProfile',
  '-Command',
  'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress',
];

function normalize(raw: Record<string, unknown>): RawProcess {
  return {
    pid: Number(raw.pid ?? raw.ProcessId ?? 0),
    name: String(raw.name ?? raw.Name ?? ''),
    cmdline: String(raw.cmdline ?? raw.CommandLine ?? ''),
  };
}

function parseProcesses(out: string, platform: NodeJS.Platform): RawProcess[] {
  const trimmed = out.trim();
  if (!trimmed) return [];
  if (platform === 'win32') {
    const parsed = JSON.parse(trimmed) as unknown;
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((item) => normalize(item as Record<string, unknown>));
  }
  return trimmed
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
      return m ? { pid: Number(m[1]), name: m[2], cmdline: m[3] } : { pid: 0, name: '', cmdline: line };
    });
}

export async function scanProcesses(runner: CommandRunner, platform: NodeJS.Platform): Promise<RawProcess[]> {
  const out =
    platform === 'win32'
      ? await runner.run('powershell', WIN_COMMAND)
      : await runner.run('ps', ['-eo', 'pid=,comm=,args=']);
  return parseProcesses(out, platform);
}
