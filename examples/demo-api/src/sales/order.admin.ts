import {
  AdminPrint,
  html,
  AdminAction,
  AdminCan,
  AdminResource,
  AdminResourceBase,
  type ActionOutcome,
  type AdminContext,
  type FieldsConfig,
  type FormConfig,
  type LayoutConfig,
  type ListConfig,
} from '@nest-my-admin/core';
import { ConflictException } from '@nestjs/common';
import { In } from 'typeorm';
import { CreateOrderDto, ShipOrderDto, StaleDraftsDto, UpdateOrderDto } from './order.dto.js';
import { Order } from './order.entity.js';
import { OrderLineAdmin } from './order-line.admin.js';
import { OrderStatusLogAdmin } from './order-status-log.admin.js';

/**
 * Orders move through their statuses with actions, never through the form: Mark paid, Ship (asks for the tracking
 * code; also for a selection) and Cancel (drafts only, asks first). Each needs `order.action.<name>` and, being
 * actions on records, `order.update`.
 *
 * Two ways to say no: an `@AdminCan('<action>')` rule takes the button away from records it does not fit (and the
 * API answers 403), and an exception thrown by the method is shown to the user as the reason.
 */
/** Applies a decorator only in the configured demo (not with `NMA_DEMO_PLAIN=1`). */
const onlyOwner = (decorator: MethodDecorator): MethodDecorator => (process.env.NMA_DEMO_PLAIN === '1' ? () => undefined : decorator);

const plainDemo = process.env.NMA_DEMO_PLAIN === '1';

/** The order form's sections: the order, then its lines inline (in the configured demo: read-only, with pictures, and totals). */
const orderMain: LayoutConfig = [
  { section: { en: 'Order', fa: 'سفارش' }, fields: ['number', 'customer', 'total', 'tracking'], columns: 2 },
  // Saved with the order in one transaction; `position` is written 0, 1, 2… by drag and the arrows.
  {
    section: { en: 'Lines', fa: 'ردیف‌ها' },
    inline: OrderLineAdmin,
    display: 'table',
    fields: ['productId', 'description', 'quantity', 'unitPrice'],
    order: 'position',
    max: 50,
    ...(plainDemo ? {} : { readonly: true, computed: ['thumb'] }),
  },
  ...(plainDemo
    ? []
    : [
        {
          section: { en: 'Totals', fa: 'جمع' },
          summary: [
            { label: { en: 'Items', fa: 'اقلام' }, value: { computed: 'lineCount' } },
            { label: { en: 'Total', fa: 'مبلغ نهایی' }, value: 'total' },
          ],
        },
      ]),
];

/** In the configured demo, beside the sections: payment and «Handled by» cards (spec §5.6). */
const orderLayout: FormConfig['layout'] =
  process.env.NMA_DEMO_PLAIN === '1'
    ? orderMain
    : {
        main: orderMain,
        aside: [
          { title: { en: 'Payment', fa: 'پرداخت' }, icon: 'credit-card', fields: ['status', 'total', 'tracking'] },
          { title: { en: 'Handled by', fa: 'مسئول سفارش' }, icon: 'user', fields: { relation: 'handledById', fields: ['position'] }, link: true },
        ],
      };

@AdminResource(Order, { icon: 'cart', label: { en: 'Order', fa: 'سفارش' }, title: 'number' })
export class OrderAdmin extends AdminResourceBase<Order> {
  list: ListConfig<Order> = {
    columns: ['id', 'number', 'customer', 'total', 'status', 'tracking'],
    sort: '-id',
    search: ['number', 'customer'],
    filters: ['status'],
    mobile: { title: 'number', subtitle: 'customer', badge: 'status', meta: ['total', 'tracking'] },
    computed: { lineCount: { label: { en: 'items', fa: 'قلم کالا' }, kind: 'count', source: { aggregate: 'count', relation: 'lines' } } },
    // «Export to Excel» in the configured demo: the list as filtered, as an .xlsx.
    ...(plainDemo ? {} : { export: true }),
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
    handledById: { label: { en: 'Handled by', fa: 'مسئول' } },
    fulfillment: {
      label: { en: 'Fulfillment', fa: 'وضعیت ارسال' },
      enumLabels: {
        queued: { en: 'Queued', fa: 'در صف' },
        confirmed: { en: 'Confirmed', fa: 'تأیید' },
        preparing: { en: 'Preparing', fa: 'آماده‌سازی' },
        ready: { en: 'Ready to ship', fa: 'آماده ارسال' },
        posted: { en: 'Posted', fa: 'تحویل پست' },
        delivered: { en: 'Delivered', fa: 'تحویل شده' },
        cancelled: { en: 'Cancelled', fa: 'لغو شده' },
      },
      // The configured demo shows it as the order's steps, with the times from the status log.
      ...(plainDemo ? {} : { widget: 'stepper' as const, exclude: ['cancelled'], history: { inline: OrderStatusLogAdmin, value: 'value', at: 'at', where: { field: 'fulfillment' } } }),
    },
  };
  form: FormConfig = {
    create: CreateOrderDto,
    update: UpdateOrderDto,
    // The design's order page (configured demo): the order opens as text, cards beside it.
    ...(process.env.NMA_DEMO_PLAIN === '1'
      ? {}
      : {
          mode: 'view' as const,
          header: { badges: ['status'], subtitle: ['customer', 'createdAt', { computed: 'lineCount' }], stepper: 'fulfillment' },
        }),
    layout: orderLayout,
  };


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

  /**
   * The order's next step (the design's filled header button): its label names the step on each order, and on an
   * order with no next step there is no button (`label.for` returns null) and a run is refused. Left out of the
   * plain demo (`NMA_DEMO_PLAIN=1`), a host that sets none of the owner-admin options.
   */
  @onlyOwner(
    AdminAction({
      primary: true,
      label: {
        static: { en: 'Next step', fa: 'مرحله بعد' },
        for: (order: Order) =>
          order.status === 'draft' ? { en: 'Move to «paid»', fa: 'انتقال به «پرداخت‌شده»' } : order.status === 'paid' ? { en: 'Move to «shipped»', fa: 'انتقال به «ارسال‌شده»' } : null,
      },
    }),
  )
  async advanceNext(order: Order, _input: unknown, ctx: AdminContext): Promise<ActionOutcome> {
    const next = order.status === 'draft' ? 'paid' : 'shipped';
    await this.repositoryFor(ctx).update(order.id, { status: next });
    return { message: { en: `Order ${order.number} is ${next}`, fa: `سفارش ${order.number}: ${next === 'paid' ? 'پرداخت‌شده' : 'ارسال‌شده'}` } };
  }

  /** A printable invoice (configured demo): the record page's «Invoice» button, also on a list selection. */
  @onlyOwner(AdminPrint({ label: { en: 'Invoice', fa: 'فاکتور' }, bulk: true }))
  invoice(orders: Order[]) {
    return html`${orders.map(
      (order) => html`<section class="nma-print-page">
        <h1>Invoice ${order.number}</h1>
        <p>Customer: ${order.customer}</p>
        <p>Total: ${order.total}</p>
      </section>`,
    )}`;
  }

  /** Only drafts can be paid or cancelled: on other orders the buttons are not there (`_perm.actions`), and the API answers 403. */
  @AdminCan('markPaid') @AdminCan('cancel') onlyDrafts(order: Order) {
    return order.status === 'draft';
  }

  /** An order that left (or will never leave) has nothing to ship. */
  @AdminCan('ship') notClosed(order: Order) {
    return order.status === 'draft' || order.status === 'paid';
  }

  /**
   * A resource action: a button on the list's toolbar that runs once, without a selection. The admin checks the
   * permission and nothing else: which rows it touches is up to the method.
   */
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
    // A resource action is handed no records, so nothing has applied the row restrictions of `query()` for it:
    // it starts from them itself, or it would cancel orders the user cannot even see.
    const repository = this.repositoryFor(ctx);
    const stale = await this.query(repository.createQueryBuilder('entity'), ctx)
      .andWhere('entity.status = :status', { status: 'draft' })
      .andWhere('entity.createdAt < :before', { before })
      .getMany();
    if (stale.length > 0) await repository.update({ id: In(stale.map((order) => order.id)), status: 'draft' }, { status: 'cancelled' });
    const count = stale.length;
    return count === 0
      ? { message: { en: `No draft is older than ${days} days`, fa: `هیچ پیش‌نویسی قدیمی‌تر از ${days} روز نیست` } }
      : { message: { en: `${count} stale drafts cancelled`, fa: `${count} پیش‌نویس قدیمی لغو شد` } };
  }
}
