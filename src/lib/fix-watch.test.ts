import { describe, expect, it } from 'vitest';
import { fixedSince, mergeFixed, seenFrom } from './fix-watch';
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
