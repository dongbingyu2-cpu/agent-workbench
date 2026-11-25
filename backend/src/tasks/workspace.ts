import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';

export interface Workspace {
  taskDir(taskId: string): string;
  /** Remember a custom directory loaded from SQLite so every helper resolves inside it. */
  registerTaskDir?(taskId: string, dir: string): void;
  /** If `customDir` is set, every task path resolves under that directory instead of the default root. */
  resolveDir(customDir: string, taskId: string): string;
  ensureCustomDir(customDir: string, taskId: string): string;
  ensureTaskDir(taskId: string): string;
  writeShared(taskId: string, background: string): void;
  partDir(taskId: string, partId: string): string;
  resultPath(taskId: string, partId: string): string;
  donePath(taskId: string, partId: string): string;
  readResult(taskId: string, partId: string): string;
  writePrompt(taskId: string, partId: string, text: string): string;
  watchPartCompletion(taskId: string, partId: string, onDone: () => void): () => void;
}

type Watch = (dir: string, cb: (name: string) => void) => () => void;

const defaultWatch: Watch = (dir, cb) => {
  const watcher = chokidar.watch(dir, { ignoreInitial: true });
  watcher.on('add', (p: string) => cb(path.basename(p)));
  return () => {
    void watcher.close();
  };
};

export class FsWorkspace implements Workspace {
  private readonly customDirs = new Map<string, string>();

  constructor(
    private readonly root: string,
    private readonly watch?: Watch,
  ) {}

  registerTaskDir(taskId: string, dir: string): void {
    if (dir && dir.trim()) this.customDirs.set(taskId, dir);
  }

  /** A user-picked directory: the task lives directly inside it (no extra nesting). */
  resolveDir(customDir: string, _taskId: string): string {
    return path.resolve(customDir);
  }

  ensureCustomDir(customDir: string, taskId: string): string {
    const dir = this.resolveDir(customDir, taskId);
    mkdirSync(path.join(dir, 'parts'), { recursive: true });
    this.customDirs.set(taskId, dir);
    return dir;
  }
  taskDir(taskId: string): string {
    return this.customDirs.get(taskId) ?? path.join(this.root, taskId);
  }

  partDir(taskId: string, partId: string): string {
    return path.join(this.taskDir(taskId), 'parts', partId);
  }

  ensureTaskDir(taskId: string): string {
    mkdirSync(path.join(this.taskDir(taskId), 'parts'), { recursive: true });
    return this.taskDir(taskId);
  }

  writeShared(taskId: string, background: string): void {
    this.ensureTaskDir(taskId);
    writeFileSync(path.join(this.taskDir(taskId), 'SHARED.md'), background, 'utf8');
  }

  resultPath(taskId: string, partId: string): string {
    return path.join(this.partDir(taskId, partId), 'RESULT.md');
  }

  donePath(taskId: string, partId: string): string {
    return path.join(this.partDir(taskId, partId), 'DONE');
  }

  readResult(taskId: string, partId: string): string {
    const file = this.resultPath(taskId, partId);
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  }

  writePrompt(taskId: string, partId: string, text: string): string {
    const dir = this.partDir(taskId, partId);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'PROMPT.md');
    writeFileSync(file, text, 'utf8');
    return file;
  }

  watchPartCompletion(taskId: string, partId: string, onDone: () => void): () => void {
    const dir = this.partDir(taskId, partId);
    mkdirSync(dir, { recursive: true });
    const watch = this.watch ?? defaultWatch;
    let fired = false;
    return watch(dir, (name) => {
      if (!fired && name === 'DONE') {
        fired = true;
        onDone();
      }
    });
  }
}
