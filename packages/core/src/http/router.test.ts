import { describe, expect, test } from 'bun:test';
import { Router } from './router.js';

const noop = () => {};

describe('Router', () => {
  const router = new Router<null>()
    .add('GET', '/api/meta', noop)
    .add('GET', '/api/resources/:resource/:id', noop);

  test('matches static and parameterised paths', () => {
    expect(router.match('GET', '/api/meta')?.params).toEqual({});
    expect(router.match('GET', '/api/meta/')?.params).toEqual({});
    expect(router.match('GET', '/api/resources/order-item/12')?.params).toEqual({ resource: 'order-item', id: '12' });
  });

  test('decodes parameters', () => {
    expect(router.match('GET', '/api/resources/widget/a%20b')?.params.id).toBe('a b');
  });

  test('does not match other methods, lengths or malformed encodings', () => {
    expect(router.match('POST', '/api/meta')).toBeUndefined();
    expect(router.match('GET', '/api/resources/widget')).toBeUndefined();
    expect(router.match('GET', '/api/resources/widget/%E0%A4%A')).toBeUndefined();
  });
});
