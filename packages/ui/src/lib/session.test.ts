import { describe, expect, test } from 'bun:test';
import { routerPath, safeNext } from './session';

describe('safeNext', () => {
  test('keeps admin paths and refuses anything else', () => {
    expect(safeNext('/product/3?tab=x')).toBe('/product/3?tab=x');
    expect(safeNext(null)).toBe('/');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('javascript:alert(1)')).toBe('/');
    expect(safeNext('/login?next=/x')).toBe('/');
  });
});

describe('routerPath', () => {
  test('a browser path under the admin becomes the router path (no base twice after signing in)', () => {
    expect(routerPath('/admin/category', '/admin')).toBe('/category');
    expect(routerPath('/admin', '/admin')).toBe('/');
    expect(routerPath('/admin/login', '/admin/')).toBe('/login');
    expect(routerPath('/category', '/admin')).toBe('/category'); // already a router path
    expect(routerPath('/administrators', '/admin')).toBe('/administrators'); // not under the base
    expect(routerPath('/x', '/')).toBe('/x');
  });

  test('safeNext never sends the user back to the login page, prefixed or not', () => {
    expect(safeNext('/admin/login?next=%2Fcategory', '/admin')).toBe('/');
    expect(safeNext('/admin/category', '/admin')).toBe('/category');
  });
});
