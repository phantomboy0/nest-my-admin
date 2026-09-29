import { AdminResource, AdminResourceBase, type AdminContext, type FormConfig, type ListConfig, type RecordId } from '@nest-my-admin/core';
import { CreateProductDto, UpdateProductDto } from './product.dto.js';
import { Product } from './product.entity.js';
import { ProductsService } from './products.service.js';

@AdminResource(Product, { icon: 'package' })
export class ProductAdmin extends AdminResourceBase<Product> {
  constructor(private readonly products: ProductsService) {
    super();
  }

  list: ListConfig<Product> = { columns: ['id', 'name', 'sku', 'price', 'stock', 'status'], sort: '-id', pageSize: 20 };
  form: FormConfig = { create: CreateProductDto, update: UpdateProductDto };

  create(dto: CreateProductDto, _ctx: AdminContext) {
    return this.products.create(dto);
  }

  update(id: RecordId, dto: UpdateProductDto, _ctx: AdminContext) {
    return this.products.update(Number(id), dto);
  }
}
