import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolveCodexExecutable } from './codexExecutable';

interface RpcMessage {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { code?: number; message?: string };
  params?: Record<string, unknown>;
}

export type CodexServerEvent =
  | { type: 'output'; sessionId: string; chunk: string }
  | { type: 'completed'; sessionId: string }
  | { type: 'error'; sessionId: string; message: string };

export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
  defaultReasoningEffort: string;
}

export class CodexAppServer {
  private process?: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly listeners = new Set<(event: CodexServerEvent) => void>();
  private readonly activeTurns = new Map<string, string>();
  private readonly resumedThreads = new Set<string>();
  private initialized?: Promise<void>;

  constructor(private readonly executable?: string) {}

  subscribe(listener: (event: CodexServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async resume(sessionId: string): Promise<void> {
    await this.ready();
    if (this.resumedThreads.has(sessionId)) return;
    try {
      await this.request('thread/resume', { threadId: sessionId, excludeTurns: true });
      this.resumedThreads.add(sessionId);
    } catch (error) {
      throw this.presentError(error);
    }
  }

  async listModels(): Promise<CodexModel[]> {
    await this.ready();
    const models: CodexModel[] = [];
    let cursor: string | null = null;
    do {
      const page = await this.request('model/list', { cursor, limit: 100 }) as { data: CodexModel[]; nextCursor: string | null };
      models.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return models;
  }

  async send(sessionId: string, text: string, options: { model?: string; effort?: string } = {}): Promise<void> {
    await this.resume(sessionId);
    try {
      const result = await this.request('turn/start', { threadId: sessionId, input: [{ type: 'text', text }], ...options }) as { turn?: { id?: string } };
      if (result.turn?.id) this.activeTurns.set(sessionId, result.turn.id);
    } catch (error) {
      const message = this.errorMessage(error);
      this.publish({ type: 'error', sessionId, message });
      throw new Error(message);
    }
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.ready();
    const turnId = this.activeTurns.get(sessionId);
    if (!turnId) throw new Error('当前没有可中断的 Codex 任务');
    await this.request('turn/interrupt', { threadId: sessionId, turnId });
  }

  close(): void {
    this.process?.kill();
    this.process = undefined;
    this.resumedThreads.clear();
    this.initialized = undefined;
  }

  private async ready(): Promise<void> {
    if (!this.initialized) this.initialized = this.start();
    try {
      await this.initialized;
    } catch (error) {
      this.initialized = undefined;
      throw error;
    }
  }

  private async start(): Promise<void> {
    const executable = this.executable ?? await resolveCodexExecutable();
    const child = spawn(executable, ['app-server', '--stdio'], { stdio: 'pipe', windowsHide: true });
    this.process = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => this.receive(line));
    child.on('error', (error) => this.failAll(error));
    child.on('exit', (code) => this.failAll(new Error(`Codex app-server exited (${code ?? 'unknown'})`)));
    await this.request('initialize', {
      clientInfo: { name: 'agent-workbench', title: 'Agent Workbench', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    });
    this.notify('initialized', {});
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.process || this.process.killed || !this.process.stdin.writable) return Promise.reject(new Error('Codex app-server is not running'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process!.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.process?.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  private receive(line: string): void {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? `Codex error ${message.error.code ?? ''}`));
      else pending.resolve(message.result);
      return;
    }
    this.handleNotification(message);
  }

  private handleNotification(message: RpcMessage): void {
    const params = message.params;
    const sessionId = typeof params?.threadId === 'string' ? params.threadId : '';
    if (!sessionId) return;
    if (message.method === 'item/agentMessage/delta' && typeof params?.delta === 'string') {
      this.publish({ type: 'output', sessionId, chunk: params.delta });
    } else if (message.method === 'turn/completed') {
      this.activeTurns.delete(sessionId);
      this.publish({ type: 'completed', sessionId });
    }
  }

  private publish(event: CodexServerEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const sessionId of this.activeTurns.keys()) this.publish({ type: 'error', sessionId, message: error.message });
    this.activeTurns.clear();
    this.process = undefined;
    this.initialized = undefined;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private presentError(error: unknown): Error {
    const message = this.errorMessage(error);
    if (message.includes('already has an active writer')) {
      return new Error('此 Codex 会话当前正由 Codex Desktop 或另一客户端写入。请在桌面端关闭该会话后重试；工作台不会强行抢占。');
    }
    return new Error(message);
  }
}
