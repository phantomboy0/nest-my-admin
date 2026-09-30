import { describe, expect, test } from 'bun:test';
import { resolveAdminOptions } from './options.js';

describe('resolveAdminOptions', () => {
  test('defaults', () => {
    expect(resolveAdminOptions()).toEqual({ path: '/admin', title: 'Admin', uiDistPath: undefined, autoRegister: false });
  });

  test('normalises the mount path', () => {
    expect(resolveAdminOptions({ path: 'backoffice/' }).path).toBe('/backoffice');
    expect(resolveAdminOptions({ path: '/ops/admin' }).path).toBe('/ops/admin');
  });

  test('refuses to mount at the root or on odd paths', () => {
    expect(() => resolveAdminOptions({ path: '/' })).toThrow('must not be "/"');
    expect(() => resolveAdminOptions({ path: '/a b' })).toThrow('invalid path');
  });
});
