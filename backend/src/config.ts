import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface Config {
  port: number;
  homeDir: string;
  workspaceRoot: string;
  dbPath: string;
  eventRoot: string;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const envPort = Number(process.env.AW_PORT);
  const base: Config = {
    port: Number.isFinite(envPort) && envPort > 0 ? envPort : 4177,
    homeDir: os.homedir(),
    workspaceRoot: path.join(repoRoot, 'workspace'),
    dbPath: path.join(repoRoot, 'workbench.db'),
    eventRoot: path.join(repoRoot, 'events'),
  };
  return { ...base, ...overrides };
}
