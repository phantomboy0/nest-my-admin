import { describe, expect, test } from 'bun:test';
import { nextFocusIndex } from './focus-trap';

describe('nextFocusIndex', () => {
  test('cycles forwards and backwards between the ends', () => {
    expect(nextFocusIndex(2, 0, false)).toBe(1);
    expect(nextFocusIndex(2, 1, false)).toBe(0);
    expect(nextFocusIndex(2, 0, true)).toBe(1);
    expect(nextFocusIndex(2, 1, true)).toBe(0);
  });
  test('focus outside the trap enters at an end', () => {
    expect(nextFocusIndex(3, -1, false)).toBe(0);
    expect(nextFocusIndex(3, -1, true)).toBe(2);
  });
  test('nothing focusable means nothing to move to', () => {
    expect(nextFocusIndex(0, -1, false)).toBe(-1);
  });
});
