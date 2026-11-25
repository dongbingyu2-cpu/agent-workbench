import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  let savedPort: string | undefined;

  // The desktop shell sets AW_PORT for its backend; keep unit tests deterministic.
  beforeEach(() => {
    savedPort = process.env.AW_PORT;
    delete process.env.AW_PORT;
  });
  afterEach(() => {
    if (savedPort === undefined) delete process.env.AW_PORT;
    else process.env.AW_PORT = savedPort;
  });

  it('defaults port to 4177 and binds locally', () => {
    const c = loadConfig();
    expect(c.port).toBe(4177);
    expect(c.workspaceRoot).toMatch(/workspace$/);
    expect(c.dbPath).toMatch(/workbench\.db$/);
  });

  it('applies overrides', () => {
    const c = loadConfig({ port: 5000 });
    expect(c.port).toBe(5000);
  });

  it('honours AW_PORT when set', () => {
    process.env.AW_PORT = '5010';
    expect(loadConfig().port).toBe(5010);
  });
});
