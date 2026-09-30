import { AdminResource, AdminResourceBase, type AdminContext, type FieldsConfig, type FormConfig, type ListConfig, type RecordId } from '@nest-my-admin/core';
import { CreateProductDto, UpdateProductDto } from './product.dto.js';
import { Product } from './product.entity.js';
import { ProductsService } from './products.service.js';

const archived = (product: Product) => product.status === 'archived';

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
    editable: ['status', 'stock'],
    filters: ['status', 'categoryId', 'tags', 'price', 'stock', 'releasedOn'],
    search: ['name', 'sku', 'category.name'],
  };
  /** Archived products are read-only except their status (the service refuses other changes too). */
  fields: FieldsConfig<Product> = {
    name: { label: { en: 'Name', fa: 'نام' }, readonlyIf: archived },
    slug: {
      widget: 'slug',
      slugFrom: 'name',
      label: { en: 'Slug', fa: 'نامک' },
      help: { en: 'The product’s address in the shop.', fa: 'نشانی محصول در فروشگاه.' },
      readonlyIf: archived,
    },
    sku: { label: { en: 'Sku', fa: 'کد کالا' } },
    price: { widget: 'money', currency: 'USD', label: { en: 'Price', fa: 'قیمت' }, readonlyIf: archived },
    stock: { label: { en: 'Stock', fa: 'موجودی' }, readonlyIf: archived },
    status: {
      widget: 'badge',
      label: { en: 'Status', fa: 'وضعیت' },
      colors: { draft: 'amber', active: 'green', archived: 'gray' },
      enumLabels: { draft: { en: 'Draft', fa: 'پیش‌نویس' }, active: { en: 'Active', fa: 'فعال' }, archived: { en: 'Archived', fa: 'بایگانی‌شده' } },
    },
    releasedOn: { label: { en: 'Released on', fa: 'تاریخ عرضه' }, showIf: { status: ['active', 'archived'] }, readonlyIf: archived },
    categoryId: { label: { en: 'Category', fa: 'دسته' }, readonlyIf: archived },
    tags: { label: { en: 'Tags', fa: 'برچسب‌ها' }, readonlyIf: archived },
  };
  form: FormConfig = {
    create: CreateProductDto,
    update: UpdateProductDto,
    layout: [
      {
        tab: { en: 'General', fa: 'عمومی' },
        sections: [
          { section: { en: 'Details', fa: 'جزئیات' }, fields: ['name', 'slug', 'sku', 'status', 'releasedOn'], columns: 2 },
          { section: { en: 'Pricing and stock', fa: 'قیمت و موجودی' }, fields: ['price', 'stock'], columns: 2 },
        ],
      },
      { tab: { en: 'Catalog', fa: 'کاتالوگ' }, sections: [{ fields: ['categoryId', 'tags'] }] },
    ],
  };

  links(product: Product) {
    return product.slug ? [{ label: { en: 'View in shop', fa: 'مشاهده در فروشگاه' }, href: `https://shop.example.test/p/${encodeURIComponent(product.slug)}` }] : [];
  }

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
