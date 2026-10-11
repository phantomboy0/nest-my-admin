import {
  AdminAction,
  AdminCan,
  AdminResource,
  AdminResourceBase,
  type ActionOutcome,
  type AdminContext,
  type FieldsConfig,
  type FormConfig,
  type ListConfig,
} from '@nest-my-admin/core';
import { ConflictException } from '@nestjs/common';
import { LessThan } from 'typeorm';
import { CreateOrderDto, ShipOrderDto, StaleDraftsDto, UpdateOrderDto } from './order.dto.js';
import { Order } from './order.entity.js';

/**
 * Orders move through their statuses with actions, never through the form: Mark paid, Ship (asks for the tracking
 * code; also for a selection) and Cancel (drafts only, asks first). Each needs `order.action.<name>` and, being
 * actions on records, `order.update`.
 *
 * Two ways to say no: an `@AdminCan('<action>')` rule takes the button away from records it does not fit (and the
 * API answers 403), and an exception thrown by the method is shown to the user as the reason.
 */
@AdminResource(Order, { icon: 'cart', label: { en: 'Order', fa: 'سفارش' }, title: 'number' })
export class OrderAdmin extends AdminResourceBase<Order> {
  list: ListConfig<Order> = {
    columns: ['id', 'number', 'customer', 'total', 'status', 'tracking'],
    sort: '-id',
    search: ['number', 'customer'],
    filters: ['status'],
    mobile: { title: 'number', subtitle: 'customer', badge: 'status', meta: ['total', 'tracking'] },
  };
  fields: FieldsConfig<Order> = {
    number: { label: { en: 'Number', fa: 'شماره' } },
    customer: { label: { en: 'Customer', fa: 'مشتری' } },
    total: { widget: 'money', currency: 'USD', label: { en: 'Total', fa: 'جمع' } },
    status: {
      widget: 'badge',
      label: { en: 'Status', fa: 'وضعیت' },
      colors: { draft: 'amber', paid: 'blue', shipped: 'green', cancelled: 'gray' },
      enumLabels: {
        draft: { en: 'Draft', fa: 'پیش‌نویس' },
        paid: { en: 'Paid', fa: 'پرداخت‌شده' },
        shipped: { en: 'Shipped', fa: 'ارسال‌شده' },
        cancelled: { en: 'Cancelled', fa: 'لغوشده' },
      },
    },
    tracking: { label: { en: 'Tracking code', fa: 'کد رهگیری' }, readonly: true },
  };
  form: FormConfig = { create: CreateOrderDto, update: UpdateOrderDto };

  @AdminAction({ label: { en: 'Mark paid', fa: 'پرداخت شد' }, icon: 'credit-card' })
  async markPaid(order: Order, _input: unknown, ctx: AdminContext): Promise<ActionOutcome> {
    await this.repositoryFor(ctx).update(order.id, { status: 'paid' });
    return { message: { en: `Order ${order.number} is paid`, fa: `سفارش ${order.number} پرداخت شد` } };
  }

  /** Also offered for a selection: each order is shipped on its own, so one that cannot be shipped does not stop the rest. */
  @AdminAction({ label: { en: 'Ship', fa: 'ارسال' }, bulk: true, input: ShipOrderDto, icon: 'truck' })
  async ship(order: Order, input: ShipOrderDto, ctx: AdminContext): Promise<ActionOutcome> {
    // A refusal of the host: the admin answers 409 with this message, and the UI shows it.
    if (order.status !== 'paid') throw new ConflictException(`Order ${order.number} is not paid yet: mark it paid first`);
    await this.repositoryFor(ctx).update(order.id, { status: 'shipped', tracking: input.tracking });
    return { message: { en: 'Shipped', fa: 'ارسال شد' } };
  }

  @AdminAction({
    label: { en: 'Cancel order', fa: 'لغو سفارش' },
    variant: 'destructive',
    confirm: { en: 'Cancel this order? It cannot be reopened.', fa: 'این سفارش لغو شود؟ دوباره باز نمی‌شود.' },
    icon: 'ban',
  })
  async cancel(order: Order, _input: unknown, ctx: AdminContext): Promise<void> {
    await this.repositoryFor(ctx).update(order.id, { status: 'cancelled' });
  }

  /** Only drafts can be paid or cancelled: on other orders the buttons are not there (`_perm.actions`), and the API answers 403. */
  @AdminCan('markPaid') @AdminCan('cancel') onlyDrafts(order: Order) {
    return order.status === 'draft';
  }

  /** An order that left (or will never leave) has nothing to ship. */
  @AdminCan('ship') notClosed(order: Order) {
    return order.status === 'draft' || order.status === 'paid';
  }

  /** A resource action: a button on the list's toolbar that runs once, without a selection. */
  @AdminAction({
    target: 'resource',
    label: { en: 'Cancel stale drafts', fa: 'لغو پیش‌نویس‌های قدیمی' },
    input: StaleDraftsDto,
    confirm: { en: 'Cancel every draft order older than this?', fa: 'همه‌ی سفارش‌های پیش‌نویس قدیمی‌تر از این لغو شوند؟' },
    variant: 'destructive',
  })
  async cancelStaleDrafts(input: StaleDraftsDto, ctx: AdminContext): Promise<ActionOutcome> {
    const days = input.olderThanDays ?? 30;
    const before = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const { affected } = await this.repositoryFor(ctx).update({ status: 'draft', createdAt: LessThan(before) }, { status: 'cancelled' });
    const count = affected ?? 0;
    return count === 0
      ? { message: { en: `No draft is older than ${days} days`, fa: `هیچ پیش‌نویسی قدیمی‌تر از ${days} روز نیست` } }
      : { message: { en: `${count} stale drafts cancelled`, fa: `${count} پیش‌نویس قدیمی لغو شد` } };
  }
}
