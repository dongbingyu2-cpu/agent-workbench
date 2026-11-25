import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function installedDesktopLocations(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-AppxPackage -Name OpenAI.Codex -ErrorAction Stop | Select-Object -ExpandProperty InstallLocation',
    ], { windowsHide: true, timeout: 10000 });
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function resolveCodexExecutable(options: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?: (file: string) => boolean;
  desktopLocations?: () => Promise<string[]>;
} = {}): Promise<string> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const configured = env.CODEX_EXECUTABLE?.trim();
  if (configured) {
    if (exists(configured)) return configured;
    throw new Error(`CODEX_EXECUTABLE 指向的文件不存在：${configured}`);
  }
  const runtime = env.CODEX_APP_RUNTIME_CLI_PATH?.trim();
  if (runtime && exists(runtime)) return runtime;
  const executable = platform === 'win32' ? 'codex.exe' : 'codex';
  for (const directory of (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean)) {
    const candidate = pathApi.join(directory, executable);
    if (exists(candidate)) return candidate;
  }
  if (platform === 'win32') {
    for (const location of await (options.desktopLocations ?? installedDesktopLocations)()) {
      const candidate = pathApi.join(location, 'app', 'resources', 'codex.exe');
      if (exists(candidate)) return candidate;
    }
  }
  throw new Error('找不到 Codex 可执行文件。请安装 Codex CLI 或桌面版，或将 CODEX_EXECUTABLE 设置为 codex.exe 的完整路径，然后重启工作台。');
}
