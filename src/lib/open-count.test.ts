import { describe, expect, it } from 'vitest';
import { badgeText, badgeTitle, STALE_AFTER, totalOpen, waitingCount } from './open-count';

describe('open bug count', () => {
  const now = 1_800_000_000_000;

  it('counts only waiting bugs', () => {
    expect(waitingCount([{ status: 'waiting' }, { status: 'fixed' }, { status: 'waiting' }])).toBe(2);
    expect(waitingCount([])).toBe(0);
  });

  it('adds up every inbox', () => {
    expect(totalOpen({ 'folder:shop': { n: 2, at: now }, 'folder:blog': { n: 1, at: now }, 'cloud:a@b.c': { n: 3, at: now } }, { now })).toBe(6);
  });

  it('skips the cloud inbox when signed out', () => {
    expect(totalOpen({ 'folder:shop': { n: 2, at: now }, 'cloud:a@b.c': { n: 3, at: now } }, { now, signedIn: false })).toBe(2);
  });

  it('forgets inboxes nobody looked at for two weeks', () => {
    expect(totalOpen({ 'folder:old': { n: 5, at: now - STALE_AFTER - 1 }, 'folder:new': { n: 1, at: now - 1000 } }, { now })).toBe(1);
  });

  it('ignores junk', () => {
    expect(totalOpen({ a: { n: -1, at: now }, b: null as never, c: { n: 'x' as never, at: now } }, { now })).toBe(0);
  });

  it('shows nothing at zero and caps at 99+', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(1)).toBe('1');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });

  it('says what the number means on hover', () => {
    expect(badgeTitle(0, 'Darnly')).toBe('Open Darnly');
    expect(badgeTitle(1, 'Darnly')).toBe('Open Darnly: 1 bug is waiting for a fix');
    expect(badgeTitle(4, 'Darnly')).toBe('Open Darnly: 4 bugs are waiting for a fix');
  });
});
