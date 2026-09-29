import type { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { Product } from './catalog/product.entity.js';

export async function seedProducts(app: INestApplication): Promise<void> {
  const products = app.get<Repository<Product>>(getRepositoryToken(Product));
  if ((await products.count()) > 0) return;
  await products.save([
    { name: 'Desk lamp', sku: 'DEMO-1', price: '24.90', stock: 12, status: 'active' },
    { name: 'Notebook', sku: 'DEMO-2', price: '3.50', stock: 200, status: 'active' },
    { name: 'Standing desk', sku: 'DEMO-3', price: '499.00', stock: 0, status: 'draft' },
  ]);
}
