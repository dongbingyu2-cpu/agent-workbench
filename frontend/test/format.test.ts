import { describe, expect, it } from 'vitest';
import { countLabel, decodeEntities, durationLabel, projectKey, projectLabel, startLabel, tokenLabel } from '../src/format';

describe('format helpers', () => {
  it('formats durations the way the session cards expect', () => {
    const base = 1_700_000_000_000;
    expect(durationLabel(base, base + 58_000)).toBe('58s');
    expect(durationLabel(base, base + 301_000)).toBe('5m1s');
    expect(durationLabel(base, base + 240_000)).toBe('4m');
    expect(durationLabel(base, base + 3 * 3600_000 + 60_000)).toBe('3h01m');
    expect(durationLabel(base, base + 288 * 3600_000 + 60_000)).toBe('288h01m');
    expect(durationLabel(base + 1000, base)).toBe('');
  });

  it('compacts token counts', () => {
    expect(tokenLabel(988)).toBe('988');
    expect(tokenLabel(199_600)).toBe('199.6k');
    expect(tokenLabel(101_235_000)).toBe('101.2m');
    expect(tokenLabel(null)).toBe('');
    expect(countLabel(1200)).toBe('1,200');
  });

  it('labels the start stamp and merges equivalent project paths', () => {
    expect(startLabel('2026-11-11T02:21:00.000Z')).toMatch(/^11-11 /);
    expect(projectKey('E:\\example workspace\\')).toBe(projectKey('e:/example workspace'));
    expect(projectLabel('')).toBe('未知项目');
    expect(projectLabel('C:\\Users\\example-user')).toBe('~ 主目录');
    expect(projectLabel('C:\\Users\\example-user\\WorkBuddy\\x')).toBe('~/WorkBuddy/x');
  });

  it('decodes escaped characters from transcripts', () => {
    expect(decodeEntities('&#x20;"D:\\a.exe" &amp; more')).toBe(' "D:\\a.exe" & more');
    expect(decodeEntities('plain text')).toBe('plain text');
  });
});
