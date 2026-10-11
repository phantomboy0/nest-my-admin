import { describe, expect, test } from 'bun:test';
import type { FieldSchema } from '../contract.js';
import { diffPlain, diffRecords, fitChanges, type AuditChange } from './diff.js';

const field = (name: string, type: FieldSchema['type'], extra: Partial<FieldSchema> = {}): FieldSchema => ({ name, label: name, type, nullable: true, primary: false, readonly: false, persisted: true, ...extra });
const NONE = new Set<string>();

describe('diffRecords', () => {
  test('scalars: only what changed, with the value before and after', () => {
    const fields = [field('name', 'string'), field('stock', 'number'), field('active', 'boolean'), field('note', 'text')];
    const before = { name: 'Lamp', stock: 3, active: true, note: null };
    const after = { name: 'Lamp', stock: 5, active: false, note: 'x' };
    expect(diffRecords(before, after, fields, NONE)).toEqual([
      { field: 'stock', before: 3, after: 5 },
      { field: 'active', before: true, after: false },
      { field: 'note', before: null, after: 'x' },
    ]);
  });

  test('unchanged fields are omitted, and a missing key is null', () => {
    const fields = [field('name', 'string'), field('note', 'text')];
    expect(diffRecords({ name: 'a' }, { name: 'a', note: null }, fields, NONE)).toEqual([]);
  });

  test('fields outside the list and dotted paths are ignored', () => {
    const fields = [field('name', 'string'), field('customer.name', 'string')];
    expect(diffRecords({ name: 'a', other: 1, 'customer.name': 'x' }, { name: 'a', other: 2, 'customer.name': 'y' }, fields, NONE)).toEqual([]);
  });

  test('decimals are strings: the same amount with other padding is no change', () => {
    const fields = [field('price', 'decimal', { scale: 2 })];
    expect(diffRecords({ price: '10.50' }, { price: '10.5' }, fields, NONE)).toEqual([]);
    expect(diffRecords({ price: '10.00' }, { price: '10' }, fields, NONE)).toEqual([]);
    expect(diffRecords({ price: '10.50' }, { price: '10.75' }, fields, NONE)).toEqual([{ field: 'price', before: '10.50', after: '10.75' }]);
  });

  test('bigints are strings whatever the driver gave', () => {
    const fields = [field('views', 'bigint')];
    expect(diffRecords({ views: '9007199254740993' }, { views: 9007199254740993n }, fields, NONE)).toEqual([]);
    expect(diffRecords({ views: 1 }, { views: '2' }, fields, NONE)).toEqual([{ field: 'views', before: '1', after: '2' }]);
  });

  test('dates: a Date and its ISO text are the same moment, and are stored as text', () => {
    const fields = [field('at', 'datetime'), field('day', 'date')];
    const moment = new Date('2026-10-09T08:30:00.000Z');
    expect(diffRecords({ at: moment, day: '2026-10-09' }, { at: '2026-10-09T08:30:00.000Z', day: '2026-10-09' }, fields, NONE)).toEqual([]);
    expect(diffRecords({ at: moment }, { at: new Date('2026-10-10T08:30:00.000Z') }, fields, NONE)).toEqual([
      { field: 'at', before: '2026-10-09T08:30:00.000Z', after: '2026-10-10T08:30:00.000Z' },
    ]);
  });

  test('JSON and objects are compared as JSON: key order is ignored, list order is not', () => {
    const fields = [field('meta', 'json'), field('address', 'object'), field('tags', 'json')];
    const before = { meta: { a: 1, b: { c: 2, d: 3 } }, address: { city: 'Tehran', zip: '1' }, tags: ['a', 'b'] };
    const after = { meta: { b: { d: 3, c: 2 }, a: 1 }, address: { zip: '1', city: 'Tehran' }, tags: ['b', 'a'] };
    expect(diffRecords(before, after, fields, NONE)).toEqual([{ field: 'tags', before: ['a', 'b'], after: ['b', 'a'] }]);
    expect(diffRecords({ meta: { a: 1 } }, { meta: { a: 2 } }, fields, NONE)).toEqual([{ field: 'meta', before: { a: 1 }, after: { a: 2 } }]);
  });

  test('relation refs are compared and stored by id, never with a title', () => {
    const fields = [field('customer', 'relation', { relation: { resource: 'customer', kind: 'to-one', idType: 'number' } as FieldSchema['relation'] })];
    expect(diffRecords({ customer: { id: 3, title: 'Ada' } }, { customer: { id: 3, title: 'Ada Lovelace' } }, fields, NONE)).toEqual([]);
    expect(diffRecords({ customer: { id: 3, title: 'Ada' } }, { customer: { id: 4, title: 'Bob' } }, fields, NONE)).toEqual([{ field: 'customer', before: 3, after: 4 }]);
    expect(diffRecords({ customer: 3 }, { customer: null }, fields, NONE)).toEqual([{ field: 'customer', before: 3, after: null }]);
  });

  test('many-to-many fields are id sets: order does not matter', () => {
    const fields = [field('tags', 'relation', { relation: { resource: 'tag', kind: 'to-many', idType: 'number' } as FieldSchema['relation'] })];
    expect(diffRecords({ tags: [{ id: 1, title: 'a' }, { id: 2, title: 'b' }] }, { tags: [2, 1] }, fields, NONE)).toEqual([]);
    expect(diffRecords({ tags: [1, 2] }, { tags: [{ id: 2, title: 'b' }, { id: 3, title: 'c' }] }, fields, NONE)).toEqual([{ field: 'tags', before: [1, 2], after: [2, 3] }]);
  });

  test('file fields are compared by key; the order of a list of files is a change', () => {
    const fields = [field('manual', 'string', { widget: 'file' }), field('photos', 'json', { widget: 'image' })];
    expect(diffRecords({ manual: 'p/manual/a.pdf', photos: ['p/1.png', 'p/2.png'] }, { manual: 'p/manual/a.pdf', photos: ['p/1.png', 'p/2.png'] }, fields, NONE)).toEqual([]);
    expect(diffRecords({ manual: 'p/manual/a.pdf', photos: ['p/1.png', 'p/2.png'] }, { manual: 'p/manual/b.pdf', photos: ['p/2.png', 'p/1.png'] }, fields, NONE)).toEqual([
      { field: 'manual', before: 'p/manual/a.pdf', after: 'p/manual/b.pdf' },
      { field: 'photos', before: ['p/1.png', 'p/2.png'], after: ['p/2.png', 'p/1.png'] },
    ]);
  });

  test('a sensitive field that changed is stored without its values', () => {
    const fields = [field('salary', 'decimal', { scale: 2 }), field('name', 'string'), field('pin', 'string')];
    const changes = diffRecords({ salary: '100.00', name: 'a', pin: '1234' }, { salary: '250.00', name: 'b', pin: '1234' }, fields, new Set(['salary', 'pin']));
    expect(changes).toEqual([{ field: 'salary', changed: true }, { field: 'name', before: 'a', after: 'b' }]);
    expect(JSON.stringify(changes)).not.toContain('250');
    expect(JSON.stringify(changes)).not.toContain('100.00');
  });

  test('create: only what has a value, as `after`', () => {
    const fields = [field('name', 'string'), field('note', 'text'), field('tags', 'json'), field('stock', 'number'), field('pin', 'string')];
    expect(diffRecords(undefined, { name: 'Lamp', note: null, tags: [], stock: 0, pin: '1234' }, fields, new Set(['pin']))).toEqual([
      { field: 'name', after: 'Lamp' },
      { field: 'stock', after: 0 },
      { field: 'pin', changed: true },
    ]);
  });

  test('delete: only what had a value, as `before`', () => {
    const fields = [field('name', 'string'), field('note', 'text'), field('pin', 'string')];
    expect(diffRecords({ name: 'Lamp', note: null, pin: '1234' }, undefined, fields, new Set(['pin']))).toEqual([{ field: 'name', before: 'Lamp' }, { field: 'pin', changed: true }]);
  });
});

describe('diffPlain', () => {
  test('compares the named keys as JSON', () => {
    const before = { name: 'ops', permissions: ['a.view', 'b.view'], scopes: { a: { view: 'own' } } };
    const after = { name: 'ops', permissions: ['a.view', 'c.view'], scopes: { a: { view: 'own' } } };
    expect(diffPlain(before, after, ['name', 'permissions', 'scopes'])).toEqual([{ field: 'permissions', before: ['a.view', 'b.view'], after: ['a.view', 'c.view'] }]);
    expect(diffPlain(undefined, { name: 'ops', permissions: [] }, ['name', 'permissions'])).toEqual([{ field: 'name', after: 'ops' }, { field: 'permissions', after: [] }]);
    expect(diffPlain({ name: 'ops', permissions: ['x'] }, undefined, ['name', 'permissions'])).toEqual([{ field: 'name', before: 'ops' }, { field: 'permissions', before: ['x'] }]);
  });
});

describe('fitChanges', () => {
  const bytes = (changes: AuditChange[]) => Buffer.byteLength(JSON.stringify(changes));

  test('small changes are stored as they are', () => {
    const changes: AuditChange[] = [{ field: 'name', before: 'a', after: 'b' }, { field: 'pin', changed: true }];
    expect(fitChanges(changes)).toEqual(changes);
  });

  test('a long text is cut and marked', () => {
    const [change] = fitChanges([{ field: 'body', before: 'x'.repeat(50_000), after: 'short' }]) as Array<{ field: string; before: string; after: string; truncated?: true }>;
    expect(change!.before.length).toBeLessThan(5_000);
    expect(change!.after).toBe('short');
    expect(change!.truncated).toBe(true);
  });

  test('a large value that is not text is left out and marked', () => {
    const big = Array.from({ length: 5_000 }, (_, index) => ({ index, text: 'row' }));
    expect(fitChanges([{ field: 'rows', before: big, after: [] }])).toEqual([{ field: 'rows', after: [], truncated: true }]);
  });

  test('whatever is changed, the entry stays under the size a TEXT column holds', () => {
    // Four-byte characters: the limit is in bytes, not characters.
    const changes: AuditChange[] = Array.from({ length: 40 }, (_, index) => ({ field: `f${index}`, before: '😀'.repeat(3_000), after: '😀'.repeat(3_500) }));
    const fitted = fitChanges(changes);
    expect(bytes(fitted)).toBeLessThan(60_000);
    expect(fitted.map((change) => change.field)).toEqual(changes.map((change) => change.field));
  });
});
