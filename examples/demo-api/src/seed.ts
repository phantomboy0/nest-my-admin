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
  const [lighting, stationery, furniture, persianStationery] = await app
    .get<Repository<Category>>(getRepositoryToken(Category))
    .save([{ name: 'Lighting' }, { name: 'Stationery' }, { name: 'Furniture' }, { name: 'نوشت‌افزار' }]);
  const [bestseller, eco, fragile, gift] = await app
    .get<Repository<Tag>>(getRepositoryToken(Tag))
    .save([{ name: 'Bestseller' }, { name: 'Eco' }, { name: 'Fragile' }, { name: 'هديه' }]);
  await products.save([
    { name: 'Desk lamp', slug: 'desk-lamp', sku: 'DEMO-1', price: '24.90', stock: 12, status: 'active', releasedOn: '2024-03-01', category: lighting, tags: [bestseller, fragile] },
    { name: 'Notebook', slug: 'notebook', sku: 'DEMO-2', price: '3.50', stock: 200, status: 'active', releasedOn: '2023-09-15', category: stationery, tags: [eco] },
    { name: 'Standing desk', slug: 'standing-desk', sku: 'DEMO-3', price: '499.00', stock: 0, status: 'draft', category: furniture, tags: [] },
    // Persian text typed on an Arabic keyboard (ي and ك): search with Persian letters still finds it.
    { name: 'دفتر يادداشت كوچك', slug: 'دفتر-یادداشت-کوچک', sku: 'DEMO-5', price: '2.00', stock: 40, status: 'active', releasedOn: '2024-03-20', category: persianStationery, tags: [gift] },
    { name: 'Brass lamp', slug: 'brass-lamp', sku: 'DEMO-4', price: '1299.00', stock: 2, status: 'archived', releasedOn: '2019-11-20', category: lighting, tags: [] },
  ]);
  const [lamp, notebook] = await products.find({ order: { id: 'ASC' }, take: 2 });
  await app.get<Repository<StockMove>>(getRepositoryToken(StockMove)).save(
    Array.from({ length: 25 }, (_, i) => ({ productId: i % 2 ? lamp!.id : notebook!.id, delta: i % 3 === 0 ? -1 : 5, reason: `Move ${i + 1}` })),
  );
}
