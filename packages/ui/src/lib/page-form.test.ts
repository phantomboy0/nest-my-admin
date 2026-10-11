import { describe, expect, test } from 'bun:test';
import type { FieldSchema, FieldType, PageResponse } from '@nest-my-admin/core/contract';
import { pageFormValues, pagePayload, validatePagePayload } from './page-form';

const field = (name: string, type: FieldType, extra: Partial<FieldSchema> = {}): FieldSchema => ({
  name, label: name, type, nullable: false, primary: false, readonly: false, persisted: false, ...extra,
});

const fields = [
  field('shopName', 'string'),
  field('lowStock', 'number', { nullable: true }),
  field('open', 'boolean'),
  field('mode', 'enum', { nullable: true, enumValues: ['sandbox', 'live'] }),
  field('liveNote', 'string', { nullable: true, showIf: { mode: 'live' } }),
  field('smtp', 'object', { nullable: true, fields: [field('host', 'string'), field('port', 'number', { nullable: true })] }),
  field('apiKey', 'string', { nullable: true, secret: true, widget: 'password' }),
  field('webhookSecret', 'string', { secret: true }),
  field('logo', 'string', { nullable: true, widget: 'image', file: { accept: ['image/*'], maxBytes: 1000, many: false } }),
];
const page: PageResponse = {
  schema: {
    name: 'shop',
    label: 'Shop',
    fields,
    constraints: {
      shopName: { required: true, minLength: 2 },
      lowStock: { min: 0, integer: true },
      'smtp.host': { required: true, maxLength: 60 },
      'smtp.port': { min: 1 },
      apiKey: { minLength: 8 },
      webhookSecret: { required: true, minLength: 8 },
    },
    required: ['shopName', 'webhookSecret'],
    readonly: false,
  },
  values: { shopName: 'Demo', lowStock: 5, open: true, mode: 'sandbox', liveNote: null, smtp: { host: 'mail.test', port: 25 }, logo: 'page/shop/logo/a.png' },
  secrets: { apiKey: true, webhookSecret: false },
  files: { logo: { key: 'page/shop/logo/a.png', name: 'a.png', contentType: 'image/png', size: 10, url: '/admin/api/files/page/shop/logo/a.png' } },
};
const initial = pageFormValues(page);

describe('settings page forms', () => {
  test('values come from the answer; secrets start empty whether one is stored or not; files come from `files`', () => {
    expect(initial).toMatchObject({ shopName: 'Demo', lowStock: '5', open: true, mode: 'sandbox', liveNote: '', apiKey: '', webhookSecret: '', smtp: { host: 'mail.test', port: '25' } });
    expect(initial.logo).toEqual({ key: 'page/shop/logo/a.png', name: 'a.png', contentType: 'image/png', size: 10, url: '/admin/api/files/page/shop/logo/a.png' });
  });

  test('an untouched form sends nothing: no value, no secret, no file', () => {
    expect(pagePayload(fields, initial, initial)).toEqual({ payload: {}, errors: {} });
  });

  test('only changed keys are sent', () => {
    expect(pagePayload(fields, { ...initial, shopName: 'Demo shop', open: false }, initial).payload).toEqual({ shopName: 'Demo shop', open: false });
    expect(pagePayload(fields, { ...initial, lowStock: '' }, initial).payload).toEqual({ lowStock: null });
  });

  test('a secret is sent only as new text or as null; never as an empty string', () => {
    expect(pagePayload(fields, { ...initial, apiKey: 'sk_live_new_key' }, initial).payload).toEqual({ apiKey: 'sk_live_new_key' });
    expect(pagePayload(fields, { ...initial, apiKey: null }, initial).payload).toEqual({ apiKey: null });
    // Typed and deleted again, or only spaces: unchanged.
    expect(pagePayload(fields, { ...initial, apiKey: '', webhookSecret: '   ' }, initial).payload).toEqual({});
    // Spaces inside or around real text belong to the secret: sent as typed.
    expect(pagePayload(fields, { ...initial, apiKey: ' sk live ' }, initial).payload).toEqual({ apiKey: ' sk live ' });
    for (const values of [initial, { ...initial, apiKey: '' }, { ...initial, apiKey: null }, { ...initial, apiKey: 'x' }]) {
      expect(Object.values(pagePayload(fields, values, initial).payload)).not.toContain('');
    }
  });

  test('a group is sent whole once one of its fields changed', () => {
    const smtp = { host: 'mail.test', port: '587' };
    expect(pagePayload(fields, { ...initial, smtp }, initial).payload).toEqual({ smtp: { host: 'mail.test', port: 587 } });
    expect(pagePayload(fields, { ...initial, smtp: { host: 'mail.test', port: 'x' } }, initial).errors).toHaveProperty(['smtp.port']);
  });

  test('a field hidden by showIf is not sent', () => {
    expect(pagePayload(fields, { ...initial, liveNote: 'careful' }, initial).payload).toEqual({});
    expect(pagePayload(fields, { ...initial, mode: 'live', liveNote: 'careful' }, initial).payload).toEqual({ mode: 'live', liveNote: 'careful' });
  });

  test('files: a new upload is sent as its token, a removed one as null', () => {
    const upload = { token: 'tok-1', name: 'b.png', size: 20, contentType: 'image/png' };
    expect(pagePayload(fields, { ...initial, logo: upload }, initial).payload).toEqual({ logo: { token: 'tok-1' } });
    expect(pagePayload(fields, { ...initial, logo: null }, initial).payload).toEqual({ logo: null });
  });

  test('required fields that are not sent never refuse a save', () => {
    // webhookSecret is required by the DTO and not stored: changing something else still saves.
    const { payload } = pagePayload(fields, { ...initial, open: false }, initial);
    expect(validatePagePayload(payload, page.schema)).toEqual({});
    expect(validatePagePayload({}, page.schema)).toEqual({});
  });

  test('what is sent is checked: a required field the user emptied, and the rules of new values', () => {
    expect(validatePagePayload(pagePayload(fields, { ...initial, shopName: '' }, initial).payload, page.schema)).toEqual({ shopName: ['is required'] });
    expect(validatePagePayload({ shopName: 'x', lowStock: -1 }, page.schema)).toEqual({ shopName: ['must be at least 2 characters'], lowStock: ['must be at least 0'] });
    expect(validatePagePayload({ apiKey: 'short' }, page.schema)).toEqual({ apiKey: ['must be at least 8 characters'] });
  });

  test('clearing a secret the DTO requires is allowed', () => {
    expect(validatePagePayload({ webhookSecret: null, apiKey: null }, page.schema)).toEqual({});
  });

  test('a group that is sent must be complete', () => {
    const { payload } = pagePayload(fields, { ...initial, smtp: { host: '', port: '25' } }, initial);
    expect(payload).toEqual({ smtp: { port: 25 } });
    expect(validatePagePayload(payload, page.schema)).toEqual({ 'smtp.host': ['is required'] });
  });
});
