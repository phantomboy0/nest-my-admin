import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AdminFiles } from '@nest-my-admin/core';
import type { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { Invoice } from '../billing/invoice.entity.js';
import { Category } from '../catalog/category.entity.js';
import { Product } from '../catalog/product.entity.js';
import { ProductMedia } from '../catalog/product-media.entity.js';
import { ProductSpec } from '../catalog/product-spec.entity.js';
import { StockMove } from '../catalog/stock-move.entity.js';
import { Supplier } from '../catalog/supplier.entity.js';
import { Tag } from '../catalog/tag.entity.js';
import { Article } from '../content/article.entity.js';
import { FULFILLMENT_STEPS, Order, type OrderStatus } from '../sales/order.entity.js';
import { OrderLine } from '../sales/order-line.entity.js';
import { OrderStatusLog } from '../sales/order-status-log.entity.js';
import { ShopSetting } from '../settings/shop-setting.entity.js';
import { Employee } from '../staff/employee.entity.js';
import { ARTICLES, CATEGORIES, CUSTOMERS, EMPLOYEES, PRODUCTS, SHOP_NAME, SUPPLIERS, TAGS } from './catalog.js';

const IMAGES = join(import.meta.dir, '../../showcase/images');
const DAY = 86_400_000;
const ORDER_DAYS = 60;

/** The same shop on every boot: screenshots stay comparable. */
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const money = (value: number) => value.toFixed(2);

/**
 * Seeds the showcase shop on an empty database. It runs before the E2E seed, whose functions then find their tables
 * filled and leave them alone (the editor account and the Support role are still added).
 */
export async function seedShowcase(app: INestApplication): Promise<void> {
  const dataSource = app.get<DataSource>(getDataSourceToken());
  if ((await dataSource.getRepository(Product).count()) > 0) return;
  const files = app.get(AdminFiles);
  const rand = random(20261104);
  const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)]!;

  // Catalog
  const categories = new Map<string, Category>();
  for (const category of CATEGORIES) categories.set(category.key, await dataSource.getRepository(Category).save({ name: category.name }));
  const tags = new Map((await dataSource.getRepository(Tag).save(TAGS.map((name) => ({ name })))).map((tag) => [tag.name, tag]));
  await dataSource.getRepository(Supplier).save(SUPPLIERS.map(({ name, email, phone }) => ({ name, contact: { email, phone } })));

  const products = new Map<string, Product>();
  // Lists show the newest first: the catalog's first product is inserted last.
  for (const item of [...PRODUCTS].reverse()) {
    const product = await dataSource.getRepository(Product).save({
      name: item.name,
      slug: item.sku.toLowerCase(),
      sku: item.sku,
      price: money(item.price),
      compareAtPrice: item.compareAt ? money(item.compareAt) : null,
      cost: money(item.cost),
      stock: item.stock,
      status: item.status,
      releasedOn: item.releasedOn ?? null,
      category: categories.get(item.category)!,
      tags: item.tags.map((name) => tags.get(name)!),
    });
    products.set(item.sku, product);
    await dataSource.getRepository(ProductSpec).save(item.specs.map(([label, value], position) => ({ productId: product.id, label, value, notes: null, position })));

    // Pictures go through AdminFiles like uploads: typed from their bytes, tracked, and cleaned up with the record.
    const picture = (n: number) => readFileSync(join(IMAGES, `${item.sku}-${n}.jpg`));
    const main = await files.register({ resource: 'product', field: 'image', recordId: product.id, body: picture(1), name: `${item.sku.toLowerCase()}.jpg` });
    await dataSource.getRepository(Product).update(product.id, { image: main.key });
    for (let n = 1; n <= item.pictures; n++) {
      const media = await dataSource.getRepository(ProductMedia).save({ productId: product.id, image: null, caption: n === 1 ? item.name : `${item.name}, view ${n}`, sort: n - 1 });
      const file = await files.register({ resource: 'product-media', field: 'image', recordId: media.id, body: picture(n), name: `${item.sku.toLowerCase()}-${n}.jpg` });
      await dataSource.getRepository(ProductMedia).update(media.id, { image: file.key });
    }
  }

  // People
  const employees = await dataSource.getRepository(Employee).save(EMPLOYEES.map((employee) => ({ ...employee, salary: money(employee.salary) })));
  const handlers = employees.slice(1);

  // Two months of orders, a few more each week.
  const now = Date.now();
  const sellable = PRODUCTS.filter((product) => product.status === 'active');
  const plans: { at: number; customer: string; lines: { sku: string; quantity: number }[] }[] = [];
  for (let day = ORDER_DAYS - 1; day >= 0; day--) {
    const count = Math.round(1 + rand() * 2 + ((ORDER_DAYS - day) / ORDER_DAYS) * 2);
    for (let i = 0; i < count; i++) {
      const at = now - day * DAY - Math.floor(rand() * 9 * 3_600_000) - 3_600_000;
      const lines = Array.from({ length: 1 + Math.floor(rand() * rand() * 4) }, () => ({ sku: pick(sellable).sku, quantity: rand() < 0.8 ? 1 : 2 }));
      plans.push({ at, customer: pick(CUSTOMERS), lines: lines.filter((line, index) => lines.findIndex((other) => other.sku === line.sku) === index) });
    }
  }
  plans.sort((a, b) => a.at - b.at);

  const moves: Partial<StockMove>[] = [];
  let invoiceNumber = 3100;
  for (const [index, plan] of plans.entries()) {
    const age = (now - plan.at) / DAY;
    const roll = rand();
    const status: OrderStatus =
      age > 10 ? (roll < 0.92 ? 'shipped' : 'cancelled') : age > 3 ? (roll < 0.5 ? 'shipped' : roll < 0.9 ? 'paid' : roll < 0.95 ? 'draft' : 'cancelled') : roll < 0.5 ? 'paid' : roll < 0.85 ? 'draft' : 'shipped';
    const fulfillment =
      status === 'cancelled' ? 'cancelled' : status === 'draft' ? 'queued' : status === 'paid' ? pick(['confirmed', 'preparing', 'ready'] as const) : age > 5 ? 'delivered' : 'posted';
    const total = plan.lines.reduce((sum, line) => sum + PRODUCTS.find((product) => product.sku === line.sku)!.price * line.quantity, 0);
    const number = `SO-${2001 + index}`;
    const order = await dataSource.getRepository(Order).save({
      number,
      customer: plan.customer,
      total: money(total),
      status,
      fulfillment,
      tracking: status === 'shipped' ? `PX${String(Math.floor(rand() * 1e9)).padStart(9, '0')}NL` : null,
      handledById: status === 'draft' ? null : pick(handlers).id,
      createdAt: new Date(plan.at),
    });
    await dataSource.getRepository(OrderLine).save(
      plan.lines.map((line, position) => {
        const product = products.get(line.sku)!;
        return { orderId: order.id, productId: product.id, description: product.name, quantity: line.quantity, unitPrice: product.price, position };
      }),
    );
    // When the parcel reached each step: the order page's stepper.
    const reached = FULFILLMENT_STEPS.slice(0, FULFILLMENT_STEPS.indexOf(fulfillment === 'cancelled' ? 'queued' : fulfillment) + 1);
    let at = plan.at;
    await dataSource.getRepository(OrderStatusLog).save(
      reached.map((value, step) => {
        at += step === 0 ? 0 : (step < 3 ? 0.4 + rand() : 6 + rand() * 30) * 3_600_000;
        return { orderId: order.id, field: 'fulfillment', value, at: new Date(Math.min(at, now)) };
      }),
    );
    if (status === 'paid' || status === 'shipped') {
      for (const line of plan.lines) moves.push({ productId: products.get(line.sku)!.id, delta: -line.quantity, reason: `Sold · ${number}` });
    }
    if (status === 'shipped' && age < 30) {
      await dataSource.getRepository(Invoice).save({ number: `INV-${invoiceNumber++}`, customer: plan.customer, total: money(total), pdf: null, createdAt: new Date(plan.at + DAY) });
    }
  }
  // Restocks and the odd correction between the sales.
  for (const item of sellable) {
    const product = products.get(item.sku)!;
    for (let i = 0; i < 2; i++) moves.push({ productId: product.id, delta: 10 + Math.floor(rand() * 30), reason: `Restock · ${pick(SUPPLIERS).name}` });
    if (rand() < 0.25) moves.push({ productId: product.id, delta: -1, reason: rand() < 0.5 ? 'Damaged in transit' : 'Inventory count' });
  }
  for (let i = moves.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [moves[i], moves[j]] = [moves[j]!, moves[i]!];
  }
  await dataSource.getRepository(StockMove).save(moves);

  // Content and settings
  for (const [index, article] of ARTICLES.entries()) {
    await dataSource.getRepository(Article).save({ ...article, createdAt: new Date(now - (ARTICLES.length - index) * 9 * DAY) });
  }
  await dataSource.getRepository(ShopSetting).save([
    { name: 'shopName', value: JSON.stringify(SHOP_NAME.en) },
    { name: 'supportEmail', value: JSON.stringify('hello@lumen-oak.example') },
    { name: 'lowStockThreshold', value: JSON.stringify(5) },
  ]);
}
