import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { readDisplayPrefs, saveDisplayPrefs } from './display-prefs';

const store = new Map<string, string>();
const original = globalThis.localStorage;
afterAll(() => {
  globalThis.localStorage = original;
});
globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
} as Storage;

describe('display preferences', () => {
  beforeEach(() => store.clear());
  test('defaults follow the language', () => {
    expect(readDisplayPrefs('fa')).toEqual({ calendar: 'persian', digits: 'latn' });
    expect(readDisplayPrefs('en')).toEqual({ calendar: 'gregorian', digits: 'latn' });
  });
  test('a saved choice wins over the default', () => {
    saveDisplayPrefs({ calendar: 'gregorian', digits: 'arabext' });
    expect(readDisplayPrefs('fa')).toEqual({ calendar: 'gregorian', digits: 'arabext' });
    store.set('nma.calendar', 'lunar');
    expect(readDisplayPrefs('en').calendar).toBe('gregorian');
  });
});
