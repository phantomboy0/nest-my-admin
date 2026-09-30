import type { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { Category } from './catalog/category.entity.js';
import { Product } from './catalog/product.entity.js';
import { StockMove } from './catalog/stock-move.entity.js';
import { Tag } from './catalog/tag.entity.js';

export async function seedProducts(app: INestApplication): Promise<void> {
  const products = app.get<Repository<Product>>(getRepositoryToken(Product));
  if ((await products.count()) > 0) return;
  const [lighting, stationery, furniture] = await app
    .get<Repository<Category>>(getRepositoryToken(Category))
    .save([{ name: 'Lighting' }, { name: 'Stationery' }, { name: 'Furniture' }]);
  const [bestseller, eco, fragile] = await app
    .get<Repository<Tag>>(getRepositoryToken(Tag))
    .save([{ name: 'Bestseller' }, { name: 'Eco' }, { name: 'Fragile' }]);
  await products.save([
    { name: 'Desk lamp', sku: 'DEMO-1', price: '24.90', stock: 12, status: 'active', category: lighting, tags: [bestseller, fragile] },
    { name: 'Notebook', sku: 'DEMO-2', price: '3.50', stock: 200, status: 'active', category: stationery, tags: [eco] },
    { name: 'Standing desk', sku: 'DEMO-3', price: '499.00', stock: 0, status: 'draft', category: furniture, tags: [] },
  ]);
  const [lamp, notebook] = await products.find({ order: { id: 'ASC' }, take: 2 });
  await app.get<Repository<StockMove>>(getRepositoryToken(StockMove)).save(
    Array.from({ length: 25 }, (_, i) => ({ productId: i % 2 ? lamp!.id : notebook!.id, delta: i % 3 === 0 ? -1 : 5, reason: `Move ${i + 1}` })),
  );
}
