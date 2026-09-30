import { describe, expect, test } from 'bun:test';
import { encodeRecordId } from './record-id';

describe('encodeRecordId', () => {
  test('matches the server encoding', () => {
    expect(encodeRecordId([1, 'a,b~c'])).toBe('1,a~1b~0c');
    expect(encodeRecordId(['new'])).toBe('~new');
    expect(encodeRecordId([42])).toBe('42');
  });
});
