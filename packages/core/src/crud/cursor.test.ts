import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Column, DataSource, Entity, PrimaryColumn } from 'typeorm';
import { applyKeyset, decodeCursor, encodeCursor } from './cursor.js';

@Entity()
class Row {
  @PrimaryColumn() a: number;
  @PrimaryColumn() b: string;
  @Column() at: Date;
}

let dataSource: DataSource;
beforeAll(async () => {
  dataSource = await new DataSource({ type: 'sqljs', entities: [Row] }).initialize();
});
afterAll(async () => {
  await dataSource.destroy();
});

describe('cursors', () => {
  test('encode the sort value then the other keys; dates as ISO', () => {
    const cursor = encodeCursor({ a: 1, b: 'x', at: new Date('2026-01-01T00:00:00Z') }, 'at', ['a', 'b']);
    expect(decodeCursor(cursor)).toEqual({ sort: 'at', values: ['2026-01-01T00:00:00.000Z', 1, 'x'] });
    expect(decodeCursor(encodeCursor({ a: 1, b: 'x' }, 'a', ['a', 'b']))).toEqual({ sort: 'a', values: [1, 'x'] });
  });

  test('reject what is not ours', () => {
    for (const raw of ['', 'nope', Buffer.from('[]').toString('base64url'), Buffer.from('{"s":1,"v":[]}').toString('base64url')]) {
      expect(decodeCursor(raw)).toBeUndefined();
    }
    expect(decodeCursor(Buffer.from(JSON.stringify({ s: 'a', v: [{}] })).toString('base64url'))).toBeUndefined();
  });

  test('the WHERE clause is direction-aware and chains the tie-breakers', () => {
    const where = (direction: 'asc' | 'desc') =>
      applyKeyset(dataSource.getRepository(Row).createQueryBuilder('e'), ['e.at', 'e.a', 'e.b'], direction, ['t', 1, 'x'])
        .getQuery()
        .replace(/.* WHERE /, '');
    expect(where('asc')).toBe(`(("e"."at" > :nmaAfter0 OR ("e"."at" = :nmaAfter0 AND ("e"."a" > :nmaAfter1 OR ("e"."a" = :nmaAfter1 AND "e"."b" > :nmaAfter2)))))`);
    expect(where('desc')).toStartWith(`(("e"."at" < :nmaAfter0 OR`);
  });
});
