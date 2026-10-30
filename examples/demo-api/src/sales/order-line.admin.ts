import { AdminCan, AdminResource, AdminResourceBase, type AdminContext, type FieldsConfig, type FormConfig, type ListConfig } from '@nest-my-admin/core';
import type { SelectQueryBuilder } from 'typeorm';
import { CreateOrderLineDto, UpdateOrderLineDto } from './order-line.dto.js';
import { OrderLine } from './order-line.entity.js';
import type { Order } from './order.entity.js';

/** Order lines have their own resource (permissions `order-line.*`); people mostly edit them inside an order. */
@AdminResource(OrderLine, { name: 'order-line', icon: 'list', label: { en: 'Order line', fa: 'ردیف سفارش' }, title: 'description' })
export class OrderLineAdmin extends AdminResourceBase<OrderLine> {
  list: ListConfig<OrderLine> = {
    columns: ['id', 'orderId', 'description', 'quantity', 'unitPrice'],
    filters: ['orderId'],
    // The product's picture, shown in the order's lines table (the order page's inline).
    computed: { thumb: { label: { en: 'Picture', fa: 'تصویر' }, kind: 'image', source: 'product.image' } },
  };
  fields: FieldsConfig<OrderLine> = {
    productId: { label: { en: 'Product', fa: 'محصول' } },
    description: { label: { en: 'Description', fa: 'شرح' } },
    quantity: { label: { en: 'Qty', fa: 'تعداد' } },
    unitPrice: { widget: 'money', currency: 'USD', label: { en: 'Unit price', fa: 'قیمت واحد' } },
    position: { label: { en: 'Position', fa: 'جایگاه' } },
  };
  form: FormConfig = { create: CreateOrderLineDto, update: UpdateOrderLineDto };

  /** Lines are read with their order, so the rules below can see its status. */
  override query(qb: SelectQueryBuilder<OrderLine>, ctx: AdminContext): SelectQueryBuilder<OrderLine> {
    return super.query(qb, ctx).leftJoinAndSelect(`${qb.alias}.order`, `${qb.alias}_line_order`);
  }

  /** A cancelled order's lines are what was ordered: none changes. */
  override readonlyFields(line: OrderLine): readonly string[] {
    return line.order?.status === 'cancelled' ? this.updateFields : [];
  }

  /** And no line is added to it. */
  @AdminCan('create') notCancelled(order: Order) {
    return order.status !== 'cancelled';
  }
}
