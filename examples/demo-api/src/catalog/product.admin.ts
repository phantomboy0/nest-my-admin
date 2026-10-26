import { AdminResource, AdminResourceBase, AdminScope, type AdminContext, type FieldsConfig, type FormConfig, type ListConfig, type RecordId } from '@nest-my-admin/core';
import { CreateProductDto, UpdateProductDto } from './product.dto.js';
import { Product } from './product.entity.js';
import { ProductMediaAdmin } from './product-media.admin.js';
import { ProductSpecAdmin } from './product-spec.admin.js';
import { ProductsService } from './products.service.js';

const archived = (product: Product) => product.status === 'archived';
/** `NMA_DEMO_PLAIN=1`: a host that sets none of the owner-admin options (see app.module.ts). */
const plain = process.env.NMA_DEMO_PLAIN === '1';

/** The design's stock badge: none left, a few left (at most 5), or in stock, with the count. */
const stockBadge = (value: unknown) => {
  const stock = Number(value ?? 0);
  if (stock === 0) return { label: { en: 'Out of stock', fa: 'ناموجود' }, tone: 'bad' as const };
  if (stock <= 5) return { label: { en: `Low · ${stock}`, fa: `رو به اتمام · ${stock.toLocaleString('fa-IR')}` }, tone: 'warn' as const };
  return { label: { en: `In stock · ${stock}`, fa: `موجود · ${stock.toLocaleString('fa-IR')}` }, tone: 'ok' as const };
};

/** The owner-admin products list (spec §5.4): picture, name over SKU, price over the earlier one, stock badge, specs, active switch. */
const ownerList: ListConfig<Product> = {
  columns: ['product', 'categoryId', 'money', 'stockBadge', 'specCount', 'active'],
  computed: {
    picture: { label: { en: 'Picture', fa: 'تصویر' }, kind: 'image', source: { first: 'media', field: 'image', by: 'sort' } },
    product: { label: { en: 'Product', fa: 'محصول' }, kind: 'title', source: 'name', subline: 'sku' },
    money: { label: { en: 'Price', fa: 'قیمت' }, kind: 'money', source: 'price', previous: 'compareAtPrice' },
    stockBadge: { label: { en: 'Stock', fa: 'موجودی' }, kind: 'badge', source: 'stock', map: stockBadge },
    specCount: { label: { en: 'Specs', fa: 'مشخصه' }, kind: 'count', source: { aggregate: 'count', relation: 'specs' }, sortable: true },
    active: { label: { en: 'Active', fa: 'فعال' }, kind: 'toggle', source: { toggle: 'status', on: 'active', off: 'archived' } },
  },
};

// `order`: products come first in the Catalog group, before the label order of the rest.
@AdminResource(Product, { icon: 'package', label: { en: 'Product', fa: 'محصول' }, order: 10 })
export class ProductAdmin extends AdminResourceBase<Product> {
  constructor(private readonly products: ProductsService) {
    super();
  }

  list: ListConfig<Product> = {
    ...(plain ? {} : { ...ownerList, columns: ['picture', ...ownerList.columns!] }),
    ...(plain ? { columns: ['id', 'image', 'name', 'sku', 'categoryId', 'price', 'cost', 'stock', 'status', 'tags'] } : {}),
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
    compareAtPrice: { widget: 'money', currency: 'USD', label: { en: 'Before sale', fa: 'قیمت پیش از تخفیف' }, readonlyIf: archived },
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
          { section: { en: 'Pricing and stock', fa: 'قیمت و موجودی' }, fields: ['price', 'compareAtPrice', 'cost', 'stock'], columns: 2 },
          { section: { en: 'Pictures', fa: 'تصاویر' }, fields: ['image', 'gallery'], columns: 2 },
        ],
      },
      { tab: { en: 'Catalog', fa: 'کاتالوگ' }, sections: [{ fields: ['categoryId', 'tags'] }] },
      // Pictures in order: the first is the list's thumbnail.
      { section: { en: 'More pictures', fa: 'تصاویر بیشتر' }, inline: ProductMediaAdmin, display: 'table', order: 'sort', max: 12 },
      // Saved with the product in one transaction; each spec is a card with the spec's own form layout.
      { section: { en: 'Specifications', fa: 'مشخصات فنی' }, inline: ProductSpecAdmin, display: 'cards', order: 'position', max: 30 },
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
