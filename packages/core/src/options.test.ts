import { describe, expect, test } from 'bun:test';
import { resolveAdminOptions } from './options.js';

describe('resolveAdminOptions', () => {
  test('defaults', () => {
    expect(resolveAdminOptions()).toEqual({
      path: '/admin', title: 'Admin', locale: 'en', locales: ['en'], branding: {}, uiDistPath: undefined, autoRegister: [], transactions: true, errorMapper: undefined,
    });
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

describe('autoRegister', () => {
  test('true means the default DataSource; a list names DataSources', () => {
    expect(resolveAdminOptions({ autoRegister: true }).autoRegister).toEqual(['default']);
    expect(resolveAdminOptions({ autoRegister: ['default', 'reports'] }).autoRegister).toEqual(['default', 'reports']);
    expect(resolveAdminOptions({}).autoRegister).toEqual([]);
  });
});

describe('locales and branding', () => {
  test('the default locale must be offered', () => {
    expect(resolveAdminOptions({ locale: 'fa', locales: ['en', 'fa'] })).toMatchObject({ locale: 'fa', locales: ['en', 'fa'] });
    expect(resolveAdminOptions({ locale: 'fa' }).locales).toEqual(['fa']);
    expect(() => resolveAdminOptions({ locale: 'fa', locales: ['en'] })).toThrow('locale "fa" must be one of locales (en)');
  });

  test('branding values that reach CSS or an <img> are checked', () => {
    expect(resolveAdminOptions({ branding: { primaryColor: '#0f766e', radius: '0.25rem', logo: '/logo.svg' } }).branding).toMatchObject({ primaryColor: '#0f766e' });
    for (const color of ['oklch(0.6 0.1 180)', 'rgb(10, 20, 30)', 'hsl(180deg 50% 40%)']) expect(() => resolveAdminOptions({ branding: { primaryColor: color } })).not.toThrow();
    for (const color of ['red; background: url(x)', 'expression(alert(1))', 'var(--x)']) {
      expect(() => resolveAdminOptions({ branding: { primaryColor: color } })).toThrow('branding.primaryColor must be a CSS colour');
    }
    expect(() => resolveAdminOptions({ branding: { radius: '1rem;}' } })).toThrow('branding.radius');
    for (const logo of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>']) expect(() => resolveAdminOptions({ branding: { logo } })).toThrow('branding.logo');
    for (const logo of ['https://cdn.example/logo.png', 'assets/logo.png', '../logo.png']) expect(() => resolveAdminOptions({ branding: { logo } })).not.toThrow();
  });
});
