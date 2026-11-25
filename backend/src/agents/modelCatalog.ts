import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentKind } from './types';

export interface CatalogModel {
  /** Value passed to the CLI's --model flag. */
  id: string;
  /** Human label shown in the picker. */
  label: string;
}

const TTL = 5 * 60 * 1000;
const cache = new Map<string, { at: number; models: CatalogModel[] }>();

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Claude Code keeps its model catalogue in an env var inside settings.json. */
function claudeModels(home: string): CatalogModel[] {
  const settings = readJson(path.join(home, '.claude', 'settings.json'));
  const raw = settings?.env?.CLAUDE_CODE_MODEL_CAPABILITIES;
  if (typeof raw !== 'string') return [];
  const seen = new Set<string>();
  const models: CatalogModel[] = [];
  for (const entry of raw.split(';')) {
    const id = entry.split('=')[0]?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label: id });
  }
  return models.sort((left, right) => left.id.localeCompare(right.id));
}

/** pi stores its catalogue in models-store.json and any user-added models in models.json. */
function piModels(home: string): CatalogModel[] {
  const dir = path.join(home, '.pi', 'agent');
  const store = readJson(path.join(dir, 'models-store.json')) ?? {};
  const config = readJson(path.join(dir, 'models.json')) ?? {};
  const seen = new Set<string>();
  const models: CatalogModel[] = [];

  const push = (provider: string, model: any) => {
    const bare = typeof model?.id === 'string' ? model.id : '';
    if (!bare) return;
    const id = bare.includes('/') ? bare : `${provider}/${bare}`;
    if (seen.has(id)) return;
    seen.add(id);
    models.push({ id, label: model?.name ? `${model.name} · ${provider}` : id });
  };

  for (const [provider, entry] of Object.entries<any>(store)) {
    for (const model of entry?.models ?? []) push(model?.provider || provider, model);
  }
  for (const [provider, entry] of Object.entries<any>(config.providers ?? {})) {
    for (const model of entry?.models ?? []) push(provider, model);
  }
  return models;
}

/** Run a CLI and collect stdout; resolves with '' on failure or timeout. */
function run(command: string, args: string[], timeoutMs = 6000): Promise<string> {
  return new Promise((resolve) => {
    const isBatch = /\.(cmd|bat)$/i.test(command);
    const child = isBatch
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${command}" ${args.join(' ')}`], { windowsHide: true })
      : spawn(command, args, { windowsHide: true });
    let out = '';
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish('');
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { out += chunk; });
    child.on('error', () => { clearTimeout(timer); finish(''); });
    child.on('close', (code) => { clearTimeout(timer); finish(code === 0 ? out : ''); });
  });
}

/** The npm shim may live outside the service's PATH, so try the installed binary first. */
function opencodeCandidates(): string[] {
  const candidates: string[] = [];
  const appData = process.env.APPDATA;
  if (appData) candidates.push(path.join(appData, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'));
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) candidates.push(path.join(localAppData, 'pnpm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'));
  candidates.push('opencode');
  return candidates;
}

function parseModels(stdout: string): CatalogModel[] {
  const seen = new Set<string>();
  const models: CatalogModel[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const id = line.trim();
    if (!id || id.includes(' ') || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label: id });
  }
  return models;
}

/** Fallback when the CLI cannot run: authenticated providers from opencode's local cache. */
function opencodeFromCache(home: string): CatalogModel[] {
  const catalogue = readJson(path.join(home, '.cache', 'opencode', 'models.json'));
  const auth = readJson(path.join(home, '.local', 'share', 'opencode', 'auth.json'));
  if (!catalogue || !auth) return [];
  const models: CatalogModel[] = [];
  const seen = new Set<string>();
  for (const provider of Object.keys(auth)) {
    for (const [id, model] of Object.entries<any>(catalogue[provider]?.models ?? {})) {
      const fullId = id.includes('/') ? id : `${provider}/${id}`;
      if (seen.has(fullId)) continue;
      seen.add(fullId);
      models.push({ id: fullId, label: model?.name ? `${model.name} · ${provider}` : fullId });
    }
  }
  return models.sort((left, right) => left.id.localeCompare(right.id));
}

/** opencode can print its own catalogue; when the CLI is busy we read its cached catalogue. */
async function opencodeModels(home: string): Promise<CatalogModel[]> {
  for (const candidate of opencodeCandidates()) {
    if (candidate !== 'opencode' && !fs.existsSync(candidate)) continue;
    const models = parseModels(await run(candidate, ['models']));
    if (models.length > 0) return models;
  }
  return opencodeFromCache(home);
}

function antigravityCandidates(): string[] {
  const candidates: string[] = [];
  const override = process.env.AW_AGY_CLI?.trim();
  if (override) candidates.push(override);
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    candidates.push(path.join(local, 'agy', 'bin', 'agy.exe'));
  }
  candidates.push('agy');
  return candidates;
}

function parseTabModels(stdout: string): CatalogModel[] {
  const seen = new Set<string>();
  const models: CatalogModel[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const id = line.slice(0, tab).trim();
    const label = line.slice(tab + 1).trim();
    if (!id || id.includes(' ') || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label: label || id });
  }
  return models;
}

async function antigravityModels(): Promise<CatalogModel[]> {
  for (const candidate of antigravityCandidates()) {
    if (candidate !== 'agy' && !fs.existsSync(candidate)) continue;
    const models = parseTabModels(await run(candidate, ['models'], 15000));
    if (models.length > 0) return models;
  }
  return [];
}

/**
 * Models each agent can be launched with. Codex is served by the app-server instead;
 * the others read a local catalogue so the composer can offer a list rather than free text.
 */
export async function listAgentModels(kind: AgentKind, options: { homeDir?: string; refresh?: boolean } = {}): Promise<CatalogModel[]> {
  const home = options.homeDir || os.homedir();
  const key = `${kind}:${home}`;
  const hit = cache.get(key);
  if (!options.refresh && hit && Date.now() - hit.at < TTL) return hit.models;

  let models: CatalogModel[] = [];
  if (kind === 'claude') models = claudeModels(home);
  else if (kind === 'pi') models = piModels(home);
  else if (kind === 'opencode') models = await opencodeModels(home);
  else if (kind === 'antigravity') models = await antigravityModels();

  cache.set(key, { at: Date.now(), models });
  return models;
}
