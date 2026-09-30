import { AdminResource, AdminResourceBase, type AdminContext, type FormConfig, type ListConfig, type RecordId } from '@nest-my-admin/core';
import { CreateProductDto, UpdateProductDto } from './product.dto.js';
import { Product } from './product.entity.js';
import { ProductsService } from './products.service.js';

@AdminResource(Product, { icon: 'package', label: { en: 'Product', fa: 'محصول' } })
export class ProductAdmin extends AdminResourceBase<Product> {
  constructor(private readonly products: ProductsService) {
    super();
  }

  list: ListConfig<Product> = {
    columns: ['id', 'name', 'sku', 'categoryId', 'price', 'stock', 'status', 'tags'],
    sort: '-id',
    pageSize: 20,
    count: 'estimate', // exact while the table is small, the planner's estimate once it is big
    filters: ['status', 'categoryId', 'tags', 'price', 'stock', 'releasedOn'],
    search: ['name', 'sku', 'category.name'],
  };
  form: FormConfig = { create: CreateProductDto, update: UpdateProductDto };

  create(dto: CreateProductDto, ctx: AdminContext) {
    return this.products.create(dto, ctx.manager);
  }

  update(id: RecordId, dto: UpdateProductDto, ctx: AdminContext) {
    return this.products.update(Number(id), dto, ctx.manager);
  }

  delete(id: RecordId, ctx: AdminContext) {
    return this.products.remove(Number(id), ctx.manager);
  }
}
