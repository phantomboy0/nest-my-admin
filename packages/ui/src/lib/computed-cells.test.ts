import { afterEach, describe, expect, test } from 'bun:test';
import type { ComputedColumnSchema } from '@nest-my-admin/core/contract';
import { applyDisplay, applyLocale } from '@/i18n';
import { cellModel } from './computed-cells';
import { setGlobalCurrency } from './money';

const column = (kind: ComputedColumnSchema['kind']): ComputedColumnSchema => ({ label: 'X', kind, sortable: false });

describe('computed cells', () => {
  afterEach(() => {
    applyLocale('en');
    applyDisplay({ calendar: 'gregorian', digits: 'latn' });
    setGlobalCurrency(undefined);
  });

  test('money: the amount with the unit, and the earlier price struck', () => {
    applyLocale('fa');
    applyDisplay({ calendar: 'persian', digits: 'arabext' });
    setGlobalCurrency({ unit: { fa: 'تومان' }, position: 'after' });
    expect(cellModel(column('money'), { value: '2890000', previous: '3250000' })).toEqual({ kind: 'money', text: '۲٬۸۹۰٬۰۰۰', unit: 'تومان', unitPosition: 'after', previous: '۳٬۲۵۰٬۰۰۰' });
    expect(cellModel(column('money'), { value: '690000', previous: null })).toEqual({ kind: 'money', text: '۶۹۰٬۰۰۰', unit: 'تومان', unitPosition: 'after' });
  });

  test('title with its subline; count in the chosen digits; badge label and tone', () => {
    expect(cellModel(column('title'), { value: 'Hoodie', subline: 'HD-BSC-014' })).toEqual({ kind: 'title', text: 'Hoodie', subline: 'HD-BSC-014' });
    applyDisplay({ calendar: 'gregorian', digits: 'arabext' });
    expect(cellModel(column('count'), { value: 12 })).toEqual({ kind: 'count', text: '۱۲' });
    expect(cellModel(column('badge'), { value: 6, label: 'Low · 6', tone: 'warn' })).toEqual({ kind: 'badge', text: 'Low · 6', tone: 'warn' });
  });

  test('an empty image is a placeholder; a toggle is on or off; nothing is a dash', () => {
    expect(cellModel(column('image'), { value: null })).toEqual({ kind: 'image' });
    expect(cellModel(column('image'), { value: '/admin/api/files/a.png' })).toEqual({ kind: 'image', src: '/admin/api/files/a.png' });
    expect(cellModel(column('toggle'), { value: true })).toEqual({ kind: 'toggle', on: true });
    expect(cellModel(column('count'), undefined)).toEqual({ kind: 'count', text: '—' });
    expect(cellModel(column('title'), { value: null })).toEqual({ kind: 'title', text: '—' });
  });
});
