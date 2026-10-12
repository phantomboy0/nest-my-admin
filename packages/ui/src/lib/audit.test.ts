import { afterAll, describe, expect, test } from 'bun:test';
import type { AuditEntry, FieldSchema, FieldType } from '@nest-my-admin/core/contract';
import { applyDisplay } from '@/i18n';
import {
  auditFilterChanges,
  auditQueryFromUrl,
  changeRow,
  entrySubject,
  eventDetail,
  eventLabel,
  formatAuditValue,
  hasAuditFilters,
  isAnonymous,
  restrictedNote,
  type AuditNames,
} from './audit';

const field = (type: FieldType, extra: Partial<FieldSchema> = {}): FieldSchema => ({
  name: 'x', label: 'X', type, nullable: true, primary: false, readonly: false, persisted: true, ...extra,
});

const entry = (event: string, extra: Partial<AuditEntry> = {}): AuditEntry => ({
  id: '1', at: '2026-10-12T06:00:00.000Z', event, actor: { id: 'u1', name: 'Ada' }, correlationId: 'c', ...extra,
});

const names: AuditNames = {
  resource: (name) => ({ product: 'Product', order: 'Order' })[name],
  action: (resource, name) => (resource === 'order' && name === 'ship' ? 'Ship' : undefined),
  page: (name) => (name === 'shop' ? 'Shop settings' : undefined),
  softDelete: (name) => name === 'product',
};

afterAll(() => applyDisplay({ calendar: 'gregorian', digits: 'latn' }));

describe('eventLabel', () => {
  test('record events', () => {
    expect(eventLabel(entry('order.created', { resource: 'order' }), names)).toBe('Created');
    expect(eventLabel(entry('order.updated', { resource: 'order' }), names)).toBe('Changed');
    expect(eventLabel(entry('order.deleted', { resource: 'order' }), names)).toBe('Deleted');
    expect(eventLabel(entry('product.deleted', { resource: 'product' }), names)).toBe('Moved to trash');
    expect(eventLabel(entry('product.restored', { resource: 'product' }), names)).toBe('Restored');
    expect(eventLabel(entry('product.purged', { resource: 'product' }), names)).toBe('Deleted for good');
  });

  test('a resource whose name holds a dot is still read by its own name', () => {
    expect(eventLabel(entry('shop.item.updated', { resource: 'shop.item' }), names)).toBe('Changed');
  });

  test('actions take their label from the schema, else their name', () => {
    expect(eventLabel(entry('order.action.ship', { resource: 'order', meta: { action: 'ship' } }), names)).toBe('Ran “Ship”');
    expect(eventLabel(entry('order.action.refund', { resource: 'order', meta: { action: 'refund' } }), names)).toBe('Ran “refund”');
    expect(eventLabel(entry('order.action.ship', { resource: 'order' }), {})).toBe('Ran “ship”');
  });

  test('settings pages', () => {
    expect(eventLabel(entry('page.shop.updated', { meta: { page: 'shop' } }), names)).toBe('Changed Shop settings');
    expect(eventLabel(entry('page.mail.updated', { meta: { page: 'mail' } }), names)).toBe('Changed mail');
  });

  test('sign-ins, with the reason of a failed one', () => {
    expect(eventLabel(entry('auth.login'), names)).toBe('Signed in');
    expect(eventLabel(entry('auth.logout'), names)).toBe('Signed out');
    expect(eventLabel(entry('auth.view_as'), names)).toBe('Viewed the admin as a user');
    expect(eventLabel(entry('auth.login_failed', { actor: null, meta: { reason: 'UNAUTHENTICATED' } }), names)).toBe('Failed sign-in');
    expect(eventLabel(entry('auth.login_failed', { actor: null, meta: { reason: 'WRONG_CODE' } }), names)).toBe('Failed sign-in: wrong two-factor code');
    expect(eventLabel(entry('auth.login_failed', { actor: null, meta: { reason: 'RATE_LIMITED' } }), names)).toBe('Failed sign-in: too many attempts');
    expect(eventLabel(entry('auth.login_failed', { actor: null, meta: { reason: 'SUPPRESSED', suppressed: 37 } }), names)).toBe('37 more failed sign-ins');
    expect(eventLabel(entry('auth.login_failed', { actor: null }), names)).toBe('Failed sign-in');
  });

  test('the note of the last failure recorded in a minute', () => {
    expect(eventDetail(entry('auth.login_failed', { actor: null, meta: { reason: 'UNAUTHENTICATED', limited: true } }))).toBe('Further failures in this minute are only counted.');
    expect(eventDetail(entry('auth.login_failed', { actor: null, meta: { reason: 'SUPPRESSED', suppressed: 3 } }))).toBe('They came in the same minute and were not recorded one by one.');
    expect(eventDetail(entry('auth.login_failed', { actor: null, meta: { reason: 'UNAUTHENTICATED' } }))).toBeUndefined();
    expect(eventDetail(entry('order.action.cancel', { resource: 'order', meta: { action: 'cancel', deleted: true } }))).toBe('The action deleted the record.');
  });

  test('roles, users and the account', () => {
    const labels = Object.fromEntries(
      [
        'rbac.role.changed', 'rbac.group.changed', 'rbac.user_roles.changed', 'rbac.user.created', 'rbac.user.changed', 'rbac.user.password_reset',
        'rbac.user.two_factor_reset', 'auth.password_changed', 'auth.two_factor_enabled', 'auth.two_factor_disabled', 'auth.recovery_codes_regenerated',
      ].map((event) => [event, eventLabel(entry(event), names)]),
    );
    expect(labels).toEqual({
      'rbac.role.changed': 'Role changed',
      'rbac.group.changed': 'Group changed',
      'rbac.user_roles.changed': 'Roles and groups of a user changed',
      'rbac.user.created': 'User created',
      'rbac.user.changed': 'User changed',
      'rbac.user.password_reset': 'Password set by an administrator',
      'rbac.user.two_factor_reset': 'Two-factor sign-in reset',
      'auth.password_changed': 'Password changed',
      'auth.two_factor_enabled': 'Two-factor sign-in turned on',
      'auth.two_factor_disabled': 'Two-factor sign-in turned off',
      'auth.recovery_codes_regenerated': 'New recovery codes',
    });
    expect(eventLabel(entry('auth.sessions_revoked', { meta: { sessions: 'others' } }), names)).toBe('Signed out everywhere else');
    expect(eventLabel(entry('auth.sessions_revoked', { meta: { sessions: 'one' } }), names)).toBe('Signed out one device');
    expect(eventLabel(entry('auth.sessions_revoked'), names)).toBe('Sessions signed out');
  });

  test('an unknown event is shown as it is', () => {
    expect(eventLabel(entry('billing.exported'), names)).toBe('billing.exported');
    expect(eventLabel(entry('auth.something_new'), names)).toBe('auth.something_new');
    expect(eventLabel(entry('order.archived', { resource: 'order' }), names)).toBe('order.archived');
    expect(eventLabel(entry(''), names)).toBe('');
  });
});

describe('entries the reader may not see', () => {
  const closed = [
    entry('*.updated', { restricted: true }),
    entry('*.created', { restricted: true }),
    entry('*.action', { restricted: true }),
    entry('page.*.updated', { restricted: true }),
  ];

  test('an anonymised entry is "a change you cannot see", never an error or an empty label', () => {
    for (const item of closed) {
      expect(isAnonymous(item)).toBe(true);
      expect(eventLabel(item, names)).toBe('A change you cannot see');
      expect(entrySubject(item, names)).toBeUndefined();
      expect(restrictedNote(item)).toBeUndefined(); // the label already says it
    }
  });

  test('a restricted record of a resource the reader knows names the resource, not the record', () => {
    const item = entry('order.updated', { resource: 'order', restricted: true });
    expect(isAnonymous(item)).toBe(false);
    expect(eventLabel(item, names)).toBe('Changed');
    expect(entrySubject(item, names)).toBe('Order');
    expect(restrictedNote(item)).toBe('A record you cannot see: its details are withheld.');
    expect(eventLabel(entry('order.action.ship', { resource: 'order', restricted: true, meta: { action: 'ship' } }), names)).toBe('Ran “Ship”');
  });

  test('restricted role and user entries keep their subject and say the changes are withheld', () => {
    const item = entry('rbac.role.changed', { recordId: 'support', restricted: true });
    expect(entrySubject(item, names)).toBe('support');
    expect(restrictedNote(item)).toBe('You may not see what was changed.');
  });

  test('an open entry has no note', () => {
    expect(restrictedNote(entry('order.updated', { resource: 'order', recordId: '4', recordTitle: 'SO-1004', changes: [] }))).toBeUndefined();
  });
});

describe('entrySubject', () => {
  test('a record by its title, or its id', () => {
    expect(entrySubject(entry('order.updated', { resource: 'order', recordId: '4', recordTitle: 'SO-1004' }), names)).toBe('Order: SO-1004');
    expect(entrySubject(entry('order.updated', { resource: 'order', recordId: '4' }), names)).toBe('Order #4');
    expect(entrySubject(entry('vault.updated', { resource: 'vault', recordId: '4' }), names)).toBe('vault #4');
    expect(entrySubject(entry('order.action.cancelStaleDrafts', { resource: 'order', meta: { action: 'cancelStaleDrafts' } }), names)).toBe('Order');
  });

  test('users, roles and failed sign-ins', () => {
    expect(entrySubject(entry('rbac.user.changed', { recordId: '2', recordTitle: 'Demo Editor' }), names)).toBe('Demo Editor');
    expect(entrySubject(entry('rbac.role.changed', { recordId: 'support' }), names)).toBe('support');
    expect(entrySubject(entry('auth.login_failed', { actor: null, meta: { username: 'root' } }), names)).toBe('root');
    expect(entrySubject(entry('auth.login'), names)).toBeUndefined();
    expect(entrySubject(entry('page.shop.updated', { meta: { page: 'shop' } }), names)).toBeUndefined(); // the label names the page
  });
});

describe('changeRow', () => {
  test('before and after through the field’s formatter', () => {
    const price = field('decimal', { name: 'price', label: 'Price', widget: 'money', currency: 'USD', scale: 2 });
    expect(changeRow({ field: 'price', before: '1234.50', after: '1300.00' }, price)).toEqual({ field: 'price', label: 'Price', state: 'values', before: '1,234.50 USD', after: '1,300.00 USD', truncated: false });
  });

  test('a create has only after, a delete only before; null is shown as empty', () => {
    const name = field('string', { name: 'name', label: 'Name' });
    expect(changeRow({ field: 'name', after: 'Lamp' }, name)).toMatchObject({ state: 'values', before: undefined, after: 'Lamp' });
    expect(changeRow({ field: 'name', before: 'Lamp' }, name)).toMatchObject({ state: 'values', before: 'Lamp', after: undefined });
    expect(changeRow({ field: 'name', before: null, after: 'Lamp' }, name)).toMatchObject({ before: '—', after: 'Lamp' });
    expect(changeRow({ field: 'name', before: '', after: 'Lamp' }, name)).toMatchObject({ before: '—', after: 'Lamp' });
  });

  test('sensitive: changed, no values; hidden: hidden', () => {
    const salary = field('decimal', { name: 'salary', label: 'Salary' });
    expect(changeRow({ field: 'salary', changed: true }, salary)).toEqual({ field: 'salary', label: 'Salary', state: 'changed', truncated: false });
    expect(changeRow({ field: 'salary', hidden: true }, undefined)).toEqual({ field: 'salary', label: 'salary', state: 'hidden', truncated: false });
    // Whatever else such a change carries is never shown.
    expect(changeRow({ field: 'salary', hidden: true, before: 1, after: 2 } as never, salary)).toEqual({ field: 'salary', label: 'Salary', state: 'hidden', truncated: false });
    expect(changeRow({ field: 'salary', changed: true, after: 2 } as never, salary)).toEqual({ field: 'salary', label: 'Salary', state: 'changed', truncated: false });
  });

  test('a field the reader’s schema does not have: its name and the raw value', () => {
    expect(changeRow({ field: 'legacy', before: 3, after: { a: 1 } }, undefined)).toEqual({ field: 'legacy', label: 'legacy', state: 'values', before: '3', after: '{"a":1}', truncated: false });
    expect(changeRow({ field: 'permissions', before: ['a.view'], after: ['a.view', 'b.view'] }, undefined)).toMatchObject({ before: 'a.view', after: 'a.view, b.view' });
    expect(changeRow({ field: 'isActive', before: true, after: false }, undefined)).toMatchObject({ before: 'Yes', after: 'No' });
  });

  test('values cut or left out for their size', () => {
    const body = field('text', { name: 'body', label: 'Body' });
    expect(changeRow({ field: 'body', before: 'aaa', after: 'bbb', truncated: true }, body)).toMatchObject({ state: 'values', before: 'aaa', after: 'bbb', truncated: true });
    expect(changeRow({ field: 'body', truncated: true }, body)).toEqual({ field: 'body', label: 'Body', state: 'dropped', truncated: true });
  });
});

describe('formatAuditValue', () => {
  test('booleans, enums with their labels, numbers and dates', () => {
    expect(formatAuditValue(true, field('boolean'))).toBe('Yes');
    expect(formatAuditValue('paid', field('enum', { enumLabels: { paid: 'Paid' } }))).toBe('Paid');
    expect(formatAuditValue('other', field('enum', { enumLabels: { paid: 'Paid' } }))).toBe('other');
    expect(formatAuditValue(12, field('number'))).toBe('12');
    expect(formatAuditValue('2024-03-20', field('date'))).toBe('Mar 20, 2024');
  });

  test('dates and digits follow the display preferences', () => {
    applyDisplay({ calendar: 'persian', digits: 'arabext' });
    expect(formatAuditValue('2024-03-20', field('date'))).toContain('۱۴۰۳');
    expect(formatAuditValue('19.90', field('decimal'))).toBe('۱۹٫۹۰');
    applyDisplay({ calendar: 'gregorian', digits: 'latn' });
  });

  test('relations are ids, with the title when one is known', () => {
    const category = field('relation', { name: 'categoryId' });
    expect(formatAuditValue(3, category)).toBe('#3');
    expect(formatAuditValue([1, 2], field('relation', { name: 'tags' }))).toBe('#1, #2');
    expect(formatAuditValue([], field('relation', { name: 'tags' }))).toBe('—');
    expect(formatAuditValue(3, category, (id) => (id === '3' ? 'Lighting' : undefined))).toBe('Lighting (#3)');
    expect(formatAuditValue(4, category, (id) => (id === '3' ? 'Lighting' : undefined))).toBe('#4');
    // A stored `{ id, title }` (an older entry) is read by its id alone.
    expect(formatAuditValue({ id: 3, title: 'Secret' }, category)).toBe('#3');
  });

  test('files are names, never links', () => {
    const file = { accept: ['*/*'], maxBytes: 1, many: false };
    expect(formatAuditValue('product/image/ab12.png', field('string', { widget: 'image', file }))).toBe('ab12.png');
    expect(formatAuditValue(['a/1.png', 'a/2.png'], field('json', { widget: 'image', file: { ...file, many: true } }))).toBe('1.png, 2.png');
  });

  test('rich text is its text: no tag of the stored HTML survives', () => {
    const body = field('text', { widget: 'richtext' });
    const html = '<h2>Care</h2><p>Wipe with a <strong>dry</strong> cloth</p><img src=x onerror="alert(1)"><script>alert(2)</script>';
    const text = formatAuditValue(html, body);
    expect(text).toBe('Care Wipe with a dry cloth alert(2)');
    expect(text).not.toMatch(/[<>]/);
    // Longer than a list excerpt: the page collapses it instead.
    expect(formatAuditValue(`<p>${'word '.repeat(100)}</p>`, body).length).toBeGreaterThan(400);
  });

  test('a value that does not fit its field is shown raw, never as [object Object]', () => {
    expect(formatAuditValue({ a: 1 }, field('string'))).toBe('{"a":1}');
    expect(formatAuditValue({ street: 'x' }, field('object'))).toBe('{"street":"x"}');
    expect(formatAuditValue('not a date', field('datetime'))).toBe('not a date');
  });
});

describe('audit filters and the URL', () => {
  const query = (search: string) => auditQueryFromUrl(new URLSearchParams(search));

  test('only the audit filters are sent, without empty ones', () => {
    expect(query('actor=1&event=auth.*&page=3&x=1&resource=')).toBe('actor=1&event=auth.*');
    expect(query('resource=order&record=4&actor=2')).toBe('actor=2&record=4&resource=order');
    expect(query('')).toBe('');
  });

  test('`before` never comes from the URL: paging is the Load more button', () => {
    expect(query('before=10&actor=1')).toBe('actor=1');
  });

  test('a record without a resource is not sent', () => {
    expect(query('record=4')).toBe('');
    expect(hasAuditFilters(new URLSearchParams('record=4'))).toBe(false);
    expect(hasAuditFilters(new URLSearchParams('resource=order'))).toBe(true);
    expect(hasAuditFilters(new URLSearchParams('page=2'))).toBe(false);
  });

  test('days are the reader’s own days, sent as instants', () => {
    const sent = new URLSearchParams(query('from=2026-10-12&to=2026-10-13'));
    expect(sent.get('from')).toBe(new Date(2026, 9, 12, 0, 0, 0, 0).toISOString());
    expect(sent.get('to')).toBe(new Date(2026, 9, 13, 23, 59, 59, 999).toISOString());
    // Anything else is sent as typed, and the server says what is wrong with it.
    expect(new URLSearchParams(query('from=yesterday')).get('from')).toBe('yesterday');
    expect(new URLSearchParams(query('from=2026-13-45')).get('from')).toBe('2026-13-45');
  });

  test('changing a filter; choosing another resource drops the record', () => {
    expect(auditFilterChanges('actor', ' 7 ')).toEqual({ actor: '7' });
    expect(auditFilterChanges('actor', '')).toEqual({ actor: null });
    expect(auditFilterChanges('resource', 'order')).toEqual({ resource: 'order', record: null });
    expect(auditFilterChanges('resource', '')).toEqual({ resource: null, record: null });
    expect(auditFilterChanges('record', '4')).toEqual({ record: '4' });
  });
});
