import { describe, expect, it } from 'vitest';
import { fixedSince, isLocalPage, mergeFixed, seenFrom } from './fix-watch';
import type { CaptureSummary } from './project-folder';

const bug = (id: string, status: 'waiting' | 'fixed', modified = 100): CaptureSummary => ({ id, title: id, status, modified });

describe('fixedSince', () => {
  it('stays quiet on first run so old fixes do not flood the panel', () => {
    expect(fixedSince(null, [bug('a', 'fixed')])).toEqual([]);
  });

  it('reports a bug that was waiting when the panel last looked, even after it was closed', () => {
    const before = seenFrom([bug('a', 'waiting'), bug('b', 'fixed')], 1000);
    expect(fixedSince(before, [bug('a', 'fixed', 500), bug('b', 'fixed')]).map((c) => c.id)).toEqual(['a']);
  });

  it('reports a bug it never saw that was fixed after it last looked', () => {
    const before = seenFrom([], 1000);
    expect(fixedSince(before, [bug('new', 'fixed', 2000), bug('old', 'fixed', 500)]).map((c) => c.id)).toEqual(['new']);
  });

  it('ignores bugs still waiting', () => {
    expect(fixedSince(seenFrom([bug('a', 'waiting')], 1000), [bug('a', 'waiting', 2000)])).toEqual([]);
  });
});

describe('mergeFixed', () => {
  it('puts new fixes first without repeats', () => {
    expect(mergeFixed([bug('a', 'fixed'), bug('b', 'fixed')], [bug('b', 'fixed')]).map((c) => c.id)).toEqual(['b', 'a']);
  });
});

describe('isLocalPage', () => {
  it('knows dev servers from live sites', () => {
    for (const u of ['http://localhost:3000/x', 'http://127.0.0.1:5173', 'http://app.localhost', 'http://192.168.1.4:8080', 'http://[::1]:3000', 'file:///Users/me/index.html']) expect(isLocalPage(u)).toBe(true);
    for (const u of ['https://www.counterdraft.com/workspace', 'https://darnly.dev', 'not a url', undefined]) expect(isLocalPage(u)).toBe(false);
  });
});
