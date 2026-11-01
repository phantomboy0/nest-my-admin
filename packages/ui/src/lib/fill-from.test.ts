import { describe, expect, test } from 'bun:test';
import type { FieldSchema } from '@nest-my-admin/core/contract';
import { applyFills, fillTemplate, initiallyTyped, noteTyped } from './fill-from';
import { toFormValues } from './form-values';

const field = (name: string, extra: Partial<FieldSchema> = {}): FieldSchema => ({
  name, label: name, type: 'string', nullable: true, primary: false, readonly: false, persisted: true, ...extra,
});
const FIELDS = [field('crm'), field('domain', { fillFrom: '{crm}.example.com' }), field('apiDomain', { fillFrom: 'api.{domain}' }), field('ref', { default: 'main' })];

describe('fillTemplate', () => {
  test('fills names in braces and is empty while one is empty', () => {
    expect(fillTemplate('{crm}.example.com', { crm: 'acme' })).toBe('acme.example.com');
    expect(fillTemplate('{a}-{b}', { a: 'x', b: ' y ' })).toBe('x-y');
    expect(fillTemplate('{crm}.example.com', { crm: '' })).toBe('');
    expect(fillTemplate('{crm}.example.com', {})).toBe('');
  });
});

describe('applyFills', () => {
  test('a chain settles in one call', () => {
    const values = applyFills(FIELDS, { crm: 'acme', domain: '', apiDomain: '', ref: 'main' }, new Set());
    expect(values).toEqual({ crm: 'acme', domain: 'acme.example.com', apiDomain: 'api.acme.example.com', ref: 'main' });
  });
  test('a typed field keeps its value and still feeds the fields after it', () => {
    const values = applyFills(FIELDS, { crm: 'acme', domain: 'shop.example.org', apiDomain: '', ref: 'main' }, new Set(['domain']));
    expect(values.domain).toBe('shop.example.org');
    expect(values.apiDomain).toBe('api.shop.example.org');
  });
  test('nothing to fill gives the same object back', () => {
    const values = { crm: '', domain: '', apiDomain: '', ref: 'main' };
    expect(applyFills(FIELDS, values, new Set())).toBe(values);
  });
});

describe('typed fields', () => {
  test('stored values start as typed; typing stops the fill and clearing starts it again', () => {
    expect([...initiallyTyped(FIELDS, { crm: 'acme', domain: 'acme.example.com', apiDomain: '' })]).toEqual(['domain']);
    const typed = new Set<string>();
    noteTyped(FIELDS, typed, 'domain', 'x.example.org');
    expect(typed.has('domain')).toBe(true);
    noteTyped(FIELDS, typed, 'domain', '');
    expect(typed.has('domain')).toBe(false);
    noteTyped(FIELDS, typed, 'crm', 'acme');
    expect(typed.has('crm')).toBe(false);
  });
});

describe('defaults', () => {
  test('a new form starts at the defaults; a record never does', () => {
    const fields = [field('ref', { default: 'main' }), field('count', { type: 'number', default: 3 }), field('on', { type: 'boolean', default: true }), field('note')];
    expect(toFormValues(fields)).toEqual({ ref: 'main', count: '3', on: true, note: '' });
    expect(toFormValues(fields, { ref: null, count: null, on: false, note: null } as never)).toEqual({ ref: '', count: '', on: false, note: '' });
  });
});
