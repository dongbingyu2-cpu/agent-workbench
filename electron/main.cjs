const { app, BrowserWindow, shell, ipcMain, clipboard, dialog } = require('electron');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { promisify } = require('node:util');
const { sessionCliExecutable, desktopExecutable, openOptions } = require('./open-targets.cjs');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.AW_PORT) || 4178;
const DIST = path.join(ROOT, 'frontend', 'dist');
const BASE = `http://127.0.0.1:${PORT}`;
const LOG_FILE = path.join(ROOT, 'electron.log');
const DSH_SESSION_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|session-(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})|orchestrator-[0-9a-f]{8,64})$/;
const ANTIGRAVITY_ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

let serverProc = null;
let locatingDesktopSession = false;
const runFile = promisify(execFile);

function log(...args) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${args.join(' ')}\n`);
  } catch {
    /* logging is best-effort */
  }
}

function probe(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('error', () => resolve(false));
    request.setTimeout(1200, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(attempts = 160) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await probe(`${BASE}/api/health`)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function ensureServer() {
  if (await probe(`${BASE}/api/health`)) {
    log('server already running on', PORT);
    return;
  }
  const tsx = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const entry = path.join(ROOT, 'backend', 'src', 'index.ts');
  log('spawning backend: node', tsx, entry, 'dist=', DIST, 'distExists=', fs.existsSync(path.join(DIST, 'index.html')));
  serverProc = spawn(process.platform === 'win32' ? 'node.exe' : 'node', [tsx, entry], {
    cwd: ROOT,
    env: { ...process.env, AW_PORT: String(PORT), AW_DIST_DIR: DIST },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  serverProc.stdout.on('data', (chunk) => log('backend:', String(chunk).trim()));
  serverProc.stderr.on('data', (chunk) => log('backend-err:', String(chunk).trim()));
  serverProc.on('error', (error) => log('spawn error:', error.message));
  serverProc.on('exit', (code) => log('backend exited with', code));
  const ready = await waitForServer();
  log('server ready:', ready);
  if (!ready) throw new Error('后端启动超时，请确认已安装依赖（npm install）。');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#141414',
    autoHideMenuBar: true,
    icon: path.join(ROOT, 'electron', 'icon.ico'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  log('loading', BASE + '/');
  win.loadURL(BASE + '/');
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  return win;
}

function assertWorkbenchSender(event) {
  if (!event.senderFrame) throw new Error('请求来源无效');
  const source = new URL(event.senderFrame.url);
  if (event.senderFrame.parent || source.origin !== BASE || source.pathname !== '/') throw new Error('请求来源无效');
}

function projectDirectory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return undefined;
  try { return fs.statSync(value).isDirectory() ? value : undefined; } catch { return undefined; }
}

app.whenReady().then(async () => {
  ipcMain.handle('pick-directory', async (event, defaultPath) => {
    assertWorkbenchSender(event);
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const resolvedDefault = projectDirectory(defaultPath);
    const result = await dialog.showOpenDialog(win, {
      title: '选择工作区文件夹',
      defaultPath: resolvedDefault,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle('agent-open-options', (event, kind, details) => {
    assertWorkbenchSender(event);
    return openOptions(kind, details);
  });
  ipcMain.handle('open-agent-session', async (event, request) => {
    assertWorkbenchSender(event);
    if (!request || typeof request.kind !== 'string' || typeof request.id !== 'string') throw new Error('会话 ID 无效');
    const mode = request.mode ?? (['claude', 'opencode', 'pi', 'antigravity'].includes(request.kind) ? 'cli' : 'desktop');
    const hasSessionId = request.id.length > 0;
    if (hasSessionId && !/^[a-zA-Z0-9_-]{1,128}$/.test(request.id)) throw new Error('会话 ID 无效');
    if (!hasSessionId && mode !== 'cli') throw new Error('会话 ID 无效');
    if (hasSessionId && request.kind === 'antigravity' && !ANTIGRAVITY_ID.test(request.id)) throw new Error('Antigravity 会话 ID 无效');
    const project = projectDirectory(request.project);
    if (mode === 'cli') {
      if (process.platform !== 'win32') throw new Error('在终端续接目前仅支持 Windows');
      const storage = request.kind === 'opencode' ? request.details?.opencodeStorage : undefined;
      const executable = await sessionCliExecutable(request.kind, storage);
      if (!executable) throw new Error('没有找到对应的 CLI，请检查安装位置或 PATH');
      const workingDirectory = project ?? (!hasSessionId || request.kind === 'antigravity' || request.kind === 'codex' || storage === 'v2' ? app.getPath('home') : undefined);
      if (!workingDirectory) throw new Error('原会话项目目录不存在，无法续接');
      const pickConversation = hasSessionId && request.kind === 'antigravity' && request.details?.origin === 'desktop';
      const literal = (value) => `'${value.replace(/'/g, "''")}'`;
      const sessionArg = hasSessionId ? ` -SessionId ${literal(request.id)}` : '';
      const resume = `& ${literal(path.join(__dirname, 'resume-cli.ps1'))} -Kind ${literal(request.kind)}${sessionArg} -Project ${literal(workingDirectory)} -Executable ${literal(executable)}${pickConversation ? ' -PickConversation' : ''}`;
      const encoded = Buffer.from(resume, 'utf16le').toString('base64');
      const launch = `Start-Process -FilePath powershell.exe -WindowStyle Normal -WorkingDirectory ${literal(workingDirectory)} -ArgumentList '-NoProfile','-NoExit','-ExecutionPolicy','Bypass','-EncodedCommand',${literal(encoded)} -ErrorAction Stop`;
      const launcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(launch, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], cwd: workingDirectory });
      let stderr = '';
      launcher.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      await new Promise((resolve, reject) => {
        launcher.once('error', reject);
        launcher.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`无法打开 PowerShell 窗口：${stderr.trim() || `退出码 ${code}`}`)));
      });
      if (pickConversation) {
        clipboard.writeText(request.id);
        return '已复制会话 ID。在 CLI 输入 /resume，按 Tab 切到 Other，查找并导入这条桌面会话。';
      }
      return;
    }
    if (mode !== 'desktop') throw new Error('打开方式无效');
    if (request.kind === 'opencode' || request.kind === 'antigravity') {
      if (request.kind === 'antigravity' && request.details?.origin === 'cli') {
        throw new Error('这条会话保存在 Antigravity CLI 中，请选 CLI 续接。');
      }
      if (locatingDesktopSession) throw new Error('正在定位桌面会话，请等当前操作完成');
      locatingDesktopSession = true;
      try {
        const executable = await desktopExecutable(request.kind);
        if (!executable) throw new Error('没有检测到对应的桌面端，请检查安装位置');
        // 通过桌面端自己的会话搜索按 ID 定位。等待页面确认后才提示成功。
        const { stdout } = await runFile('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass',
          '-File', path.join(__dirname, 'locate-desktop-session.ps1'),
          '-Kind', request.kind, '-SessionId', request.id, '-Executable', executable,
        ], { windowsHide: true, timeout: 33000 }).catch(() => ({ stdout: 'unconfirmed' }));
        const status = stdout.trim();
        if (status === 'opened') return '已定位到桌面会话';
        if (status === 'no-window') throw new Error('未检测到可用的桌面窗口，请打开应用后重试');
        clipboard.writeText(request.id);
        const search = request.kind === 'antigravity' ? '按 Ctrl+K' : '点击顶部会话搜索';
        return `自动定位未确认。已复制会话 ID，可在桌面端${search}后粘贴查找。`;
      } finally {
        locatingDesktopSession = false;
      }
    }
    if (request.kind === 'dsh') {
      // DSH 0.2.x writes bare UUIDs; newer builds use session-/orchestrator- IDs.
      if (!DSH_SESSION_ID.test(request.id)) throw new Error('DeepSeek Harness 会话 ID 无效，无法打开指定会话');
      await shell.openExternal(`dsh://open?session=${encodeURIComponent(request.id)}`);
      return;
    }
    const prefix = request.kind === 'codex' ? 'codex://threads/' : request.kind === 'workbuddy' ? 'workbuddy://chat/' : null;
    if (!prefix) throw new Error('此来源暂未支持打开指定桌面会话');
    await shell.openExternal(`${prefix}${encodeURIComponent(request.id)}`);
  });
  log('app ready, root=', ROOT, 'port=', PORT);
  try {
    await ensureServer();
  } catch (error) {
    log('ensureServer failed:', error instanceof Error ? error.message : String(error));
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
  }
});
