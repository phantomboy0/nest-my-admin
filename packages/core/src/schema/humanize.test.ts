import { describe, expect, test } from 'bun:test';
import { humanize, kebabCase } from './humanize.js';

describe('humanize', () => {
  test.each([
    ['createdAt', 'Created at'],
    ['sku_code', 'Sku code'],
    ['OrderItem', 'Order item'],
    ['HTTPStatus', 'Http status'],
    ['name', 'Name'],
    ['releasedOn', 'Released on'],
  ])('%s → %s', (input, expected) => {
    expect(humanize(input)).toBe(expected);
  });
});

describe('kebabCase', () => {
  test.each([
    ['Product', 'product'],
    ['OrderItem', 'order-item'],
    ['HTTPLog', 'http-log'],
    ['Catalog', 'catalog'],
  ])('%s → %s', (input, expected) => {
    expect(kebabCase(input)).toBe(expected);
  });
});
