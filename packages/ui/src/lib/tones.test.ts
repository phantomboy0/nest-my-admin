import { describe, expect, test } from 'bun:test';
import { toneOf } from './tones';

describe('toneOf', () => {
  test('maps every badge colour onto a design tone', () => {
    expect(toneOf('green')).toBe('ok');
    expect(toneOf('amber')).toBe('warn');
    expect(toneOf('red')).toBe('bad');
    expect(toneOf('blue')).toBe('info');
    expect(toneOf('purple')).toBe('primary');
    expect(toneOf('pink')).toBe('bad');
    expect(toneOf('gray')).toBe('neutral');
  });

  test('an unknown colour is neutral', () => {
    expect(toneOf('teal' as never)).toBe('neutral');
  });
});
