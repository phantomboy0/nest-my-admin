import { ADMIN_AUTH_ENTITIES } from '@nest-my-admin/auth';
import { ADMIN_FILE_ENTITIES, ADMIN_RBAC_ENTITIES } from '@nest-my-admin/core';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Invoice } from './billing/invoice.entity.js';
import { Category } from './catalog/category.entity.js';
import { Product } from './catalog/product.entity.js';
import { StockMove } from './catalog/stock-move.entity.js';
import { Supplier } from './catalog/supplier.entity.js';
import { Tag } from './catalog/tag.entity.js';
import { Article } from './content/article.entity.js';
import { Order } from './sales/order.entity.js';
import { ShopSetting } from './settings/shop-setting.entity.js';

/** DATABASE_URL=postgres://… or mysql://… runs the demo on that database; without it, on in-memory sql.js. */
export function databaseOptions(url = process.env.DATABASE_URL): TypeOrmModuleOptions {
  const entities = [Product, Category, Tag, Supplier, StockMove, Article, Invoice, Order, ShopSetting, ...ADMIN_AUTH_ENTITIES, ...ADMIN_RBAC_ENTITIES, ...ADMIN_FILE_ENTITIES];
  if (!url) return { type: 'sqljs', entities, synchronize: true };
  const scheme = new URL(url).protocol.slice(0, -1);
  if (scheme === 'postgres' || scheme === 'postgresql') return { type: 'postgres', url, entities, synchronize: true };
  if (scheme === 'mysql') return { type: 'mysql', url, entities, synchronize: true };
  throw new Error(`DATABASE_URL must start with postgres:// or mysql:// (got ${scheme}://)`);
}
