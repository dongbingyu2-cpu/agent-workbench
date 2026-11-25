import { createRequire } from 'node:module';
import { StringDecoder } from 'node:string_decoder';
import { resolveWindowsCommand } from './windowsCommand';

export interface PtyProcess {
  pid: number;
  write(data: string): void;
  onData(cb: (data: Buffer) => void): void;
  onExit(cb: (code: number) => void): void;
  kill(): void;
}

export interface PtyFactory {
  spawn(file: string, args: string[], opts: { cwd: string; env?: Record<string, string> }): PtyProcess;
}

export interface Supervisor {
  start(agentId: string, file: string, args: string[], cwd: string): PtyProcess;
  write(agentId: string, data: string): void;
  onOutput(agentId: string, cb: (chunk: string) => void): () => void;
  stop(agentId: string): void;
  isRunning(agentId: string): boolean;
}

interface Entry {
  proc: PtyProcess;
  decoder: StringDecoder;
}

export class NodePtySupervisor implements Supervisor {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Map<string, Set<(chunk: string) => void>>();

  constructor(private readonly factory: PtyFactory) {}

  start(agentId: string, file: string, args: string[], cwd: string): PtyProcess {
    if (this.entries.has(agentId)) throw new Error(`agent already running: ${agentId}`);
    const proc = this.factory.spawn(file, args, { cwd });
    const entry: Entry = { proc, decoder: new StringDecoder('utf8') };
    this.entries.set(agentId, entry);
    proc.onData((buf) => {
      const text = entry.decoder.write(buf);
      if (text) for (const cb of this.listeners.get(agentId) ?? []) cb(text);
    });
    proc.onExit(() => {
      if (this.entries.get(agentId) === entry) {
        this.entries.delete(agentId);
        this.listeners.delete(agentId);
      }
    });
    return proc;
  }

  write(agentId: string, data: string): void {
    const entry = this.entries.get(agentId);
    if (!entry) throw new Error(`agent not running: ${agentId}`);
    entry.proc.write(data);
  }

  onOutput(agentId: string, cb: (chunk: string) => void): () => void {
    let set = this.listeners.get(agentId);
    if (!set) {
      set = new Set();
      this.listeners.set(agentId, set);
    }
    set.add(cb);
    return () => {
      set!.delete(cb);
    };
  }

  stop(agentId: string): void {
    const entry = this.entries.get(agentId);
    if (!entry) return;
    try {
      entry.proc.kill();
    } finally {
      this.entries.delete(agentId);
      this.listeners.delete(agentId);
    }
  }

  isRunning(agentId: string): boolean {
    return this.entries.has(agentId);
  }
}

export class NodePtyFactory implements PtyFactory {
  spawn(file: string, args: string[], opts: { cwd: string; env?: Record<string, string> }): PtyProcess {
    const nodeRequire = createRequire(import.meta.url);
    const pty = nodeRequire('@lydell/node-pty') as {
      spawn: (f: string, a: string[] | string, o: Record<string, unknown>) => any;
    };
    const env = opts.env ?? process.env;
    const command = process.platform === 'win32' ? resolveWindowsCommand(file, args, env) : { file, args };
    const p = pty.spawn(command.file, command.args, { name: 'xterm-color', cwd: opts.cwd, env });
    return {
      pid: p.pid,
      write: (data: string) => p.write(data),
      onData: (cb: (data: Buffer) => void) => p.onData((s: string) => cb(Buffer.from(s, 'utf8'))),
      onExit: (cb: (code: number) => void) => p.onExit((e: { exitCode: number }) => cb(e.exitCode)),
      kill: () => p.kill(),
    };
  }
}
