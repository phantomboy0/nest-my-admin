import { AdminResource, AdminResourceBase, type FieldsConfig, type ListConfig } from '@nest-my-admin/core';
import { OrderStatusLog } from './order-status-log.entity.js';

/** The log of order status changes: read by the order page's stepper, listed under «Advanced». */
@AdminResource(OrderStatusLog, { name: 'order-status-log', icon: 'history', label: { en: 'Order status log', fa: 'تاریخچه وضعیت سفارش' }, readonly: true })
export class OrderStatusLogAdmin extends AdminResourceBase<OrderStatusLog> {
  list: ListConfig<OrderStatusLog> = { columns: ['id', 'orderId', 'field', 'value', 'at'], filters: ['orderId'], sort: '-at' };
  fields: FieldsConfig<OrderStatusLog> = {
    field: { label: { en: 'Field', fa: 'فیلد' } },
    value: { label: { en: 'Value', fa: 'مقدار' } },
    at: { label: { en: 'At', fa: 'زمان' } },
  };
}
