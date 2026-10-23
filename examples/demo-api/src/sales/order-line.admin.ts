import { AdminResource, AdminResourceBase, type FieldsConfig, type FormConfig, type ListConfig } from '@nest-my-admin/core';
import { CreateOrderLineDto, UpdateOrderLineDto } from './order-line.dto.js';
import { OrderLine } from './order-line.entity.js';

/** Order lines have their own resource (permissions `order-line.*`); people mostly edit them inside an order. */
@AdminResource(OrderLine, { name: 'order-line', icon: 'list', label: { en: 'Order line', fa: 'ردیف سفارش' }, title: 'description' })
export class OrderLineAdmin extends AdminResourceBase<OrderLine> {
  list: ListConfig<OrderLine> = { columns: ['id', 'orderId', 'description', 'quantity', 'unitPrice'], filters: ['orderId'] };
  fields: FieldsConfig<OrderLine> = {
    productId: { label: { en: 'Product', fa: 'محصول' } },
    description: { label: { en: 'Description', fa: 'شرح' } },
    quantity: { label: { en: 'Qty', fa: 'تعداد' } },
    unitPrice: { widget: 'money', currency: 'USD', label: { en: 'Unit price', fa: 'قیمت واحد' } },
    position: { label: { en: 'Position', fa: 'جایگاه' } },
  };
  form: FormConfig = { create: CreateOrderLineDto, update: UpdateOrderLineDto };
}
