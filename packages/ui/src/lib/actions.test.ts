import { describe, expect, test } from 'bun:test';
import type { ActionSchema, ResourceSchema } from '@nest-my-admin/core/contract';
import { actionOutcome, actionQuestion, bulkActions, headerActions, recordActions, resourceActions, runsAtOnce, selectionResult } from './actions';
import { en } from '../i18n/en';
import { fa } from '../i18n/fa';

const action = (name: string, over: Partial<ActionSchema> = {}): ActionSchema => ({ name, label: name, target: 'record', bulk: false, atomic: false, variant: 'default', ...over });
const schema = {
  actions: [action('markPaid'), action('ship', { bulk: true, input: { fields: [], constraints: {}, required: [] } }), action('cancel', { variant: 'destructive', confirm: true }), action('recount', { target: 'resource' })],
} as ResourceSchema;
const names = (actions: ActionSchema[]) => actions.map((item) => item.name);

describe('actions', () => {
  test('a record without _perm, or without _perm.actions, allows every record action of the schema', () => {
    expect(names(recordActions(schema, { _id: '1' }))).toEqual(['markPaid', 'ship', 'cancel']);
    expect(names(recordActions(schema, { _id: '1', _perm: { update: true, delete: true } }))).toEqual(['markPaid', 'ship', 'cancel']);
    expect(names(recordActions(schema, undefined))).toEqual(['markPaid', 'ship', 'cancel']);
  });

  test('_perm.actions narrows them, in schema order; an empty list leaves none', () => {
    expect(names(recordActions(schema, { _perm: { update: true, delete: false, actions: { markPaid: false, cancel: 'cancel', ship: 'ship' } } }))).toEqual(['ship', 'cancel']);
    expect(recordActions(schema, { _perm: { update: false, delete: false, actions: {} } })).toEqual([]);
    // A name the schema no longer has (cut by the policy) is not offered.
    expect(names(recordActions(schema, { _perm: { update: true, delete: true, actions: { archive: 'archive', ship: 'ship' } } }))).toEqual(['ship']);
  });

  test('each record names its actions (a per-record label)', () => {
    const offered = recordActions(schema, { _perm: { update: true, delete: true, actions: { markPaid: 'Mark #1042 paid', ship: false, cancel: 'cancel' } } });
    expect(offered.map((item) => item.label)).toEqual(['Mark #1042 paid', 'cancel']);
  });

  test('the header: up to three buttons, the rest in ⋯, the primary last and filled', () => {
    const many = { actions: ['a', 'b', 'c', 'd', 'e'].map((name) => action(name)).concat(action('next', { primary: true })) } as ResourceSchema;
    const header = headerActions(many, { _perm: { update: true, delete: true, actions: { a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', next: 'Move to «ready to ship»' } } });
    expect(header.primary).toMatchObject({ name: 'next', label: 'Move to «ready to ship»' });
    expect(names(header.buttons)).toEqual(['a', 'b', 'c']);
    expect(names(header.overflow)).toEqual(['d', 'e']);
    expect(headerActions(many, { _perm: { update: true, delete: true, actions: { a: 'a', next: false } } })).toEqual({ buttons: [many.actions[0]!], overflow: [] });
    // A primary action without input or confirm runs on the click.
    expect(runsAtOnce(action('next', { primary: true }))).toBe(true);
  });

  test('the list toolbar gets resource actions, the selection bar bulk ones', () => {
    expect(names(resourceActions(schema))).toEqual(['recount']);
    expect(names(bulkActions(schema, []))).toEqual(['ship']);
    const refused = { _perm: { update: true, delete: true, actions: { markPaid: 'markPaid', ship: false } } };
    const allowed = { _perm: { update: true, delete: true, actions: { ship: 'ship' } } };
    expect(bulkActions(schema, [refused])).toEqual([]);
    expect(names(bulkActions(schema, [refused, allowed]))).toEqual(['ship']);
  });

  test('an action without input and confirmation runs on the click', () => {
    expect(runsAtOnce(schema.actions[0]!)).toBe(true);
    expect(runsAtOnce(schema.actions[1]!)).toBe(false);
    expect(runsAtOnce(schema.actions[2]!)).toBe(false);
    expect(runsAtOnce(action('x', { confirm: 'Sure?' }))).toBe(false);
  });

  test('a destructive action, or a run on more than one record, never runs on the click', () => {
    const plain = action('markPaid', { bulk: true });
    expect(runsAtOnce(plain, 0)).toBe(true);
    expect(runsAtOnce(plain, 1)).toBe(true);
    expect(runsAtOnce(plain, 2)).toBe(false);
    expect(runsAtOnce(action('wipe', { variant: 'destructive' }))).toBe(false);
    expect(runsAtOnce(action('wipe', { variant: 'destructive' }), 1)).toBe(false);
    expect(runsAtOnce(action('purgeAll', { target: 'resource', variant: 'destructive' }), 0)).toBe(false);
  });

  test('the question: the host\'s own text, or a default naming the record or the count', () => {
    const texts = (messages: Record<string, string>) => (key: string, params: Record<string, string | number> = {}) =>
      messages[key]!.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name]));
    const t = texts(en);
    const plain = action('Mark paid', { bulk: true });
    const wipe = action('Wipe', { variant: 'destructive' });
    // Nothing to ask: one record, not destructive, no `confirm`.
    expect(actionQuestion(plain, 1, 'SO-1', t)).toBeUndefined();
    expect(actionQuestion(action('Recount', { target: 'resource' }), 0, undefined, t)).toBeUndefined();
    // Asked without `confirm`.
    expect(actionQuestion(plain, 3, undefined, t)).toBe('Run “Mark paid” on 3 records?');
    expect(actionQuestion(wipe, 1, 'SO-1', t)).toBe('Run “Wipe” on SO-1?');
    expect(actionQuestion(wipe, 1, undefined, t)).toBe('Run “Wipe”?');
    expect(actionQuestion(action('Purge', { target: 'resource', variant: 'destructive' }), 0, undefined, t)).toBe('Run “Purge”?');
    expect(actionQuestion(plain, 3, undefined, texts(fa))).toBe(fa['action.confirmSelected'].replace('{action}', 'Mark paid').replace('{count}', '3'));
    expect(fa['action.confirmSelected']).toContain('{count}');
    // `confirm: true` asks the same; a text of the host is used as it is.
    expect(actionQuestion(action('Archive', { confirm: true }), 2, undefined, t)).toBe('Run “Archive” on 2 records?');
    expect(actionQuestion(action('Archive', { confirm: 'Really archive?' }), 2, undefined, t)).toBe('Really archive?');
  });

  test('the answer is told apart by its shape', () => {
    expect(actionOutcome({ record: { _id: '1' }, message: 'Shipped' })).toEqual({ kind: 'record', record: { _id: '1' }, message: 'Shipped' });
    expect(actionOutcome({ record: null })).toEqual({ kind: 'record', record: null });
    expect(actionOutcome({ ok: ['1'], failed: [{ id: '2', code: 'CONFLICT', message: 'Already shipped' }] })).toEqual({
      kind: 'bulk',
      result: { ok: ['1'], failed: [{ id: '2', code: 'CONFLICT', message: 'Already shipped' }] },
    });
    expect(actionOutcome({ message: 'Counted 3 orders' })).toEqual({ kind: 'resource', message: 'Counted 3 orders' });
    expect(actionOutcome({})).toEqual({ kind: 'resource' });
  });

  test('a selection of one record is answered like a single run: it counts as one success', () => {
    expect(selectionResult(actionOutcome({ record: null }), ['7'])).toEqual({ ok: ['7'], failed: [] });
    expect(selectionResult(actionOutcome({ ok: ['1'], failed: [] }), ['1', '2'])).toEqual({ ok: ['1'], failed: [] });
  });
});
