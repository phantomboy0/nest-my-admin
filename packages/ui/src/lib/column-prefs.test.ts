import { describe, expect, test } from 'bun:test';
import { MAX_WIDTH, MIN_WIDTH, createColumnStore, visibleColumns } from './column-prefs';

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};
const columns = ['id', 'name', 'sku', 'price'];

describe('column prefs (Review Focus 4)', () => {
  test('hide, reorder and survive a reload', () => {
    const storage = memory();
    const store = createColumnStore(storage);
    store.toggle('product', 'sku');
    store.move('product', columns, 'price', -1);
    store.move('product', columns, 'price', -1);
    expect(visibleColumns(columns, store.get('product'))).toEqual(['id', 'price', 'name']);
    expect(visibleColumns(columns, createColumnStore(storage).get('product'))).toEqual(['id', 'price', 'name']);
  });

  test('columns the schema dropped disappear; new ones are appended', () => {
    const store = createColumnStore(memory());
    store.move('product', columns, 'price', -1);
    expect(visibleColumns(['id', 'name', 'price', 'stock'], store.get('product'))).toEqual(['id', 'name', 'price', 'stock']);
    expect(visibleColumns(['price', 'id'], store.get('product'))).toEqual(['id', 'price']);
  });

  test('moving past either end does nothing', () => {
    const store = createColumnStore(memory());
    store.move('product', columns, 'id', -1);
    store.move('product', columns, 'price', 1);
    expect(visibleColumns(columns, store.get('product'))).toEqual(columns);
  });

  test('widths are clamped; density and reset', () => {
    const store = createColumnStore(memory());
    store.setWidth('product', 'name', 5);
    store.setWidth('product', 'sku', 5000);
    store.setDensity('product', 'compact');
    expect(store.get('product')).toMatchObject({ widths: { name: MIN_WIDTH, sku: MAX_WIDTH }, density: 'compact' });
    store.reset('product');
    expect(store.get('product')).toEqual({ order: [], hidden: [], widths: {}, density: 'comfortable' });
  });

  test('storage that throws falls back to memory', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const store = createColumnStore(broken);
    store.toggle('product', 'sku');
    expect(store.get('product').hidden).toEqual(['sku']);
    store.reset('product');
    expect(store.get('product').hidden).toEqual([]);
  });
});
