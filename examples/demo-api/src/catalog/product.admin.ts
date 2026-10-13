import { AdminResource, AdminResourceBase, AdminScope, type AdminContext, type FieldsConfig, type FormConfig, type ListConfig, type RecordId } from '@nest-my-admin/core';
import { CreateProductDto, UpdateProductDto } from './product.dto.js';
import { Product } from './product.entity.js';
import { ProductsService } from './products.service.js';

const archived = (product: Product) => product.status === 'archived';

// `order`: products come first in the Catalog group, before the label order of the rest.
@AdminResource(Product, { icon: 'package', label: { en: 'Product', fa: 'محصول' }, order: 10 })
export class ProductAdmin extends AdminResourceBase<Product> {
  constructor(private readonly products: ProductsService) {
    super();
  }

  list: ListConfig<Product> = {
    columns: ['id', 'image', 'name', 'sku', 'categoryId', 'price', 'cost', 'stock', 'status', 'tags'],
    sort: '-id',
    pageSize: 20,
    count: 'estimate', // exact while the table is small, the planner's estimate once it is big
    editable: ['status', 'stock'],
    filters: ['status', 'categoryId', 'tags', 'price', 'stock', 'releasedOn'],
    search: ['name', 'sku', 'category.name'],
    mobile: { title: 'name', subtitle: 'category.name', badge: 'status', meta: ['sku', 'price', 'stock'] },
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
    cost: { widget: 'money', currency: 'USD', label: { en: 'Cost', fa: 'بهای تمام‌شده' }, restricted: true, readonlyIf: archived },
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
    // Product pictures are not secret, but the demo's storage has no public URL, so they too are served by the admin.
    image: { widget: 'image', label: { en: 'Image', fa: 'تصویر' }, file: { visibility: 'public', maxBytes: 2 * 1024 * 1024 }, readonlyIf: archived },
    gallery: { widget: 'image', many: true, label: { en: 'Gallery', fa: 'گالری' }, file: { visibility: 'public', maxBytes: 2 * 1024 * 1024 }, readonlyIf: archived },
  };
  form: FormConfig = {
    create: CreateProductDto,
    update: UpdateProductDto,
    layout: [
      {
        tab: { en: 'General', fa: 'عمومی' },
        sections: [
          { section: { en: 'Details', fa: 'جزئیات' }, fields: ['name', 'slug', 'sku', 'status', 'releasedOn'], columns: 2 },
          { section: { en: 'Pricing and stock', fa: 'قیمت و موجودی' }, fields: ['price', 'cost', 'stock'], columns: 2 },
          { section: { en: 'Pictures', fa: 'تصاویر' }, fields: ['image', 'gallery'], columns: 2 },
        ],
      },
      { tab: { en: 'Catalog', fa: 'کاتالوگ' }, sections: [{ fields: ['categoryId', 'tags'] }] },
    ],
  };

  /** Row scope for roles: products still in draft (the editor role may change only these). */
  @AdminScope('drafts') drafts() {
    return { status: 'draft' };
  }

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
