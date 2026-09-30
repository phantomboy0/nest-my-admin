import type { Brackets as BracketsType, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { Brackets } from 'typeorm';
import type { SortDirection } from '../contract.js';

/** A keyset position: the sort field it belongs to and the row's sort value, then its key values. */
export interface Cursor {
  sort: string;
  values: unknown[];
}

const toJson = (value: unknown) => (value instanceof Date ? value.toISOString() : typeof value === 'bigint' ? String(value) : value);

/** `after` for the page following `row`: base64url JSON `{ s, v }`. */
export function encodeCursor(row: object, sortField: string, keys: string[]): string {
  const source = row as Record<string, unknown>;
  const values = [sortField, ...keys.filter((key) => key !== sortField)].map((name) => toJson(source[name]));
  return Buffer.from(JSON.stringify({ s: sortField, v: values })).toString('base64url');
}

/** The cursor in `after`, or undefined when it is not one of ours. Values are checked against their fields by the caller. */
export function decodeCursor(raw: string): Cursor | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { s, v } = parsed as { s?: unknown; v?: unknown };
    if (typeof s !== 'string' || !Array.isArray(v) || v.some((value) => value === null || typeof value === 'object')) return undefined;
    return { sort: s, values: v };
  } catch {
    return undefined;
  }
}

/**
 * Rows after the cursor in `ORDER BY sort <direction>, key1, key2… ASC`:
 * `sort ⋗ v OR (sort = v AND (key1 > a1 OR (key1 = a1 AND key2 > a2 …)))`, with every value a bound parameter.
 */
export function applyKeyset<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  columns: string[],
  direction: SortDirection,
  values: unknown[],
): SelectQueryBuilder<T> {
  const params: Record<string, unknown> = {};
  values.forEach((value, index) => (params[`nmaAfter${index}`] = value));
  const after = (index: number): string => {
    const op = index === 0 && direction === 'desc' ? '<' : '>';
    const strict = `${columns[index]} ${op} :nmaAfter${index}`;
    if (index === columns.length - 1) return strict;
    return `(${strict} OR (${columns[index]} = :nmaAfter${index} AND ${after(index + 1)}))`;
  };
  return qb.andWhere(new Brackets((inner) => inner.where(after(0), params)) as BracketsType);
}
