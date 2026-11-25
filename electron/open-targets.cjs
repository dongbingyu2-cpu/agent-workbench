const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
const dual = new Set(['antigravity', 'opencode', 'codex']);
const desktopNames = {
  antigravity: { file: 'Antigravity.exe', locations: ['antigravity'] },
  opencode: { file: 'OpenCode.exe', locations: ['ai.opencode.desktop', 'OpenCode', 'opencode-desktop'] },
};
const cliNames = { antigravity: 'agy', opencode: 'opencode', codex: 'codex', claude: 'claude', pi: 'pi' };

function isFile(file) {
  try { return path.isAbsolute(file) && fs.statSync(file).isFile(); } catch { return false; }
}

function extraCliFolders() {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  return [
    path.join(appData, 'npm'),
    path.join(local, 'pnpm'),
    path.join(home, '.pi', 'agent', 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, 'scoop', 'shims'),
  ];
}

function cliExecutable(kind) {
  const command = cliNames[kind];
  if (!command || process.platform !== 'win32') return undefined;
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const overrides = kind === 'antigravity'
    ? [process.env.AW_AGY_CLI]
    : kind === 'codex'
      ? [process.env.CODEX_EXECUTABLE, process.env.CODEX_APP_RUNTIME_CLI_PATH]
      : [];
  const pathFolders = (process.env.PATH || '').split(path.delimiter).map((folder) => folder.trim().replace(/^"|"$/g, '')).filter(path.isAbsolute);
  const folders = [...new Set([...pathFolders, ...extraCliFolders()])];
  const candidates = [...overrides, ...folders.flatMap((folder) => ['.cmd', '.exe', '.bat'].map((extension) => path.join(folder, command + extension)))];
  // Antigravity 安装器将 agy 放在本机应用目录，当前工作台可能还未继承新 PATH。
  if (kind === 'antigravity') candidates.push(path.join(local, 'agy', 'bin', 'agy.exe'));
  return candidates.find(isFile);
}

async function codexAppxExecutable() {
  if (process.platform !== 'win32') return undefined;
  try {
    const { stdout } = await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-AppxPackage -Name OpenAI.Codex -ErrorAction Stop | Select-Object -ExpandProperty InstallLocation',
    ], { windowsHide: true, timeout: 4000 });
    for (const location of stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
      const candidate = path.join(location, 'app', 'resources', 'codex.exe');
      if (isFile(candidate)) return candidate;
    }
  } catch {}
  return undefined;
}

async function desktopExecutable(kind) {
  const app = desktopNames[kind];
  if (!app || process.platform !== 'win32') return undefined;
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const override = kind === 'opencode' ? process.env.AW_OPENCODE_DESKTOP : process.env.AW_ANTIGRAVITY_DESKTOP;
  const roots = [path.join(local, 'Programs'), process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
  const candidates = [override, ...roots.flatMap((root) => app.locations.map((name) => path.join(root, name, app.file)))];
  const known = candidates.find((file) => isFile(file) && path.extname(file).toLowerCase() === '.exe');
  if (known) return known;
  for (const hive of ['HKCU', 'HKLM']) {
    const keys = [
      `${hive}\\Software\\Classes\\${kind}\\shell\\open\\command`,
      `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${app.file}`,
    ];
    for (const key of keys) {
      try {
        const { stdout } = await run('reg.exe', ['query', key, '/ve'], { windowsHide: true, timeout: 3000 });
        const file = stdout.match(/REG_(?:EXPAND_)?SZ\s+"?([^"\r\n]+?\.exe)(?="|\s|$)/i)?.[1]?.trim();
        if (isFile(file) && path.basename(file).toLowerCase() === app.file.toLowerCase()) return file;
      } catch {}
    }
  }
  return undefined;
}

function bundledOpenCodeCli(desktop) {
  const candidate = desktop && path.join(path.dirname(desktop), 'resources', 'opencode-cli.exe');
  return isFile(candidate) ? candidate : undefined;
}

async function sessionCliExecutable(kind, storage) {
  if (kind === 'opencode' && storage === 'v2') {
    // V2 会话交给桌面端附带的同版本 CLI，避免 PATH 中的 V1 读到旧记录。
    return bundledOpenCodeCli(await desktopExecutable(kind));
  }
  const direct = cliExecutable(kind);
  if (direct) return direct;
  if (kind === 'codex') return codexAppxExecutable();
  return undefined;
}

async function openOptions(kind, details) {
  if (!dual.has(kind)) return [];
  const desktop = kind === 'codex' || (kind !== 'antigravity' || details?.origin !== 'cli') && Boolean(await desktopExecutable(kind));
  return [
    { mode: 'desktop', available: desktop },
    { mode: 'cli', available: Boolean(await sessionCliExecutable(kind, details?.opencodeStorage)) },
  ];
}

module.exports = { sessionCliExecutable, desktopExecutable, openOptions };
