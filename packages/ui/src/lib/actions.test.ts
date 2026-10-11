import { describe, expect, test } from 'bun:test';
import type { ActionSchema, ResourceSchema } from '@nest-my-admin/core/contract';
import { actionOutcome, bulkActions, recordActions, resourceActions, runsAtOnce, selectionResult } from './actions';

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
    expect(names(recordActions(schema, { _perm: { update: true, delete: false, actions: ['cancel', 'ship'] } }))).toEqual(['ship', 'cancel']);
    expect(recordActions(schema, { _perm: { update: false, delete: false, actions: [] } })).toEqual([]);
    // A name the schema no longer has (cut by the policy) is not offered.
    expect(names(recordActions(schema, { _perm: { update: true, delete: true, actions: ['archive', 'ship'] } }))).toEqual(['ship']);
  });

  test('the list toolbar gets resource actions, the selection bar bulk ones', () => {
    expect(names(resourceActions(schema))).toEqual(['recount']);
    expect(names(bulkActions(schema, []))).toEqual(['ship']);
    const refused = { _perm: { update: true, delete: true, actions: ['markPaid'] } };
    const allowed = { _perm: { update: true, delete: true, actions: ['ship'] } };
    expect(bulkActions(schema, [refused])).toEqual([]);
    expect(names(bulkActions(schema, [refused, allowed]))).toEqual(['ship']);
  });

  test('an action without input and confirmation runs on the click', () => {
    expect(runsAtOnce(schema.actions[0]!)).toBe(true);
    expect(runsAtOnce(schema.actions[1]!)).toBe(false);
    expect(runsAtOnce(schema.actions[2]!)).toBe(false);
    expect(runsAtOnce(action('x', { confirm: 'Sure?' }))).toBe(false);
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
