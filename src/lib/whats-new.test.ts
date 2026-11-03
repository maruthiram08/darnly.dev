import { describe, expect, it } from 'vitest';
import { isNewer, whatsNewUrl } from './whats-new';

describe('whatsNewUrl', () => {
  it('opens the new version section after an update', () => {
    expect(whatsNewUrl('update', '0.3.1', '0.3.2')).toBe('https://darnly.dev/changelog/#v0-3-2');
  });
  it('stays quiet on install, same-version reloads, downgrades and Chrome updates', () => {
    expect(whatsNewUrl('install', undefined, '0.3.2')).toBeNull();
    expect(whatsNewUrl('update', '0.3.2', '0.3.2')).toBeNull();
    expect(whatsNewUrl('update', '0.4.0', '0.3.2')).toBeNull();
    expect(whatsNewUrl('chrome_update', '0.3.1', '0.3.2')).toBeNull();
  });
  it('compares versions as numbers', () => {
    expect(isNewer('0.3.10', '0.3.9')).toBe(true);
    expect(isNewer('0.4', '0.3.9')).toBe(true);
    expect(isNewer('0.3.1', '0.3.1.0')).toBe(false);
  });
});
