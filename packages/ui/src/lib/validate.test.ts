import { describe, expect, test } from 'bun:test';
import type { FieldConstraints } from '@nest-my-admin/core/contract';
import { validatePayload } from './validate';

const constraints: Record<string, FieldConstraints> = {
  name: { required: true, minLength: 2, maxLength: 5 },
  slug: { required: false, pattern: { source: '^[a-z]+$', flags: 'i', message: 'letters only' } },
  stock: { required: false, integer: true, min: 0, max: 10 },
  email: { format: 'email' },
  site: { format: 'url' },
  ref: { format: 'uuid' },
  status: { oneOf: ['draft', 'live'] },
};

describe('validatePayload', () => {
  test('accepts valid values and treats flags like the server (Review Focus 5)', () => {
    expect(validatePayload({ name: 'Lamp', slug: 'ABC', stock: 3, email: 'a@b.co', site: 'https://x.io', status: 'live' }, constraints, 'create')).toEqual({});
  });

  test('reports each broken rule with the server-style message', () => {
    expect(
      validatePayload(
        { name: 'L', slug: 'a-b', stock: 1.5, email: 'nope', site: 'ftp://x', ref: 'x', status: 'gone' },
        constraints,
        'create',
      ),
    ).toEqual({
      name: ['must be at least 2 characters'],
      slug: ['letters only'],
      stock: ['must be an integer'],
      email: ['must be an email address'],
      site: ['must be a URL'],
      ref: ['must be a UUID'],
      status: ['must be one of: draft, live'],
    });
    expect(validatePayload({ name: 'Too long', stock: 11 }, constraints, 'create')).toEqual({
      name: ['must be at most 5 characters'],
      stock: ['must be at most 10'],
    });
  });

  test('required fields: missing on create, only cleared ones on update', () => {
    expect(validatePayload({}, constraints, 'create')).toEqual({ name: ['is required'] });
    expect(validatePayload({ name: '' }, constraints, 'create')).toEqual({ name: ['is required'] });
    expect(validatePayload({}, constraints, 'update')).toEqual({});
    expect(validatePayload({ name: null }, { name: { required: true } }, 'update')).toEqual({ name: ['is required'] });
  });

  test('a pattern without its own message gets a generic one', () => {
    expect(validatePayload({ code: 'x' }, { code: { pattern: { source: '^\\d+$', flags: '' } } }, 'create')).toEqual({
      code: ['is not in the expected format'],
    });
  });

  test('never rejects what the server accepts: URLs without a protocol, other protocols, unusable patterns', () => {
    expect(validatePayload({ site: 'example.com/path' }, constraints, 'create').site).toBeUndefined();
    expect(validatePayload({ site: 'ftp://files.example.com' }, constraints, 'create').site).toBeUndefined();
    expect(validatePayload({ code: 'x' }, { code: { pattern: { source: '(', flags: '' } } }, 'create')).toEqual({});
  });
});
