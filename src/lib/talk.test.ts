import { describe, expect, it } from 'vitest';
import { canTalk, joinSpoken, listen } from './talk';

describe('talk', () => {
  it('turns spoken words into a note', () => {
    expect(joinSpoken('  make   the button blue')).toBe('Make the button blue');
    expect(joinSpoken('')).toBe('');
  });

  it('says so when the browser has no speech recognition', () => {
    expect(canTalk()).toBe(false);
    let err = '';
    listen({ onText: () => {}, onDone: () => {}, onError: (e) => (err = e) });
    expect(err).toBe('unsupported');
  });
});
