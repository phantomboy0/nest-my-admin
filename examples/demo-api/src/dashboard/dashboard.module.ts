import { AdminWidget, type AdminContext, type AdminWidgetSource } from '@nest-my-admin/core';
import { Module } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Between, In, LessThanOrEqual, type Repository } from 'typeorm';
import { Product } from '../catalog/product.entity.js';
import { Order } from '../sales/order.entity.js';

/** Paid and shipped orders count as sales. */
const SOLD = In(['paid', 'shipped']);
const sum = (orders: Order[]) => orders.reduce((total, order) => total + Number(order.total), 0);
const percent = (now: number, before: number) => (before === 0 ? (now === 0 ? 0 : 100) : Math.round(((now - before) / before) * 1000) / 10);
const fa = (ctx: AdminContext) => ctx.locale === 'fa';

@AdminWidget('sales', { type: 'stat', title: { en: 'Sales', fa: 'فروش' }, order: 10 })
class SalesWidget implements AdminWidgetSource {
  constructor(@InjectRepository(Order) private readonly orders: Repository<Order>) {}
  async load(params: { from: string; to: string; previousFrom: string; previousTo: string }, ctx: AdminContext) {
    const now = sum(await this.orders.findBy({ status: SOLD, createdAt: Between(new Date(params.from), new Date(params.to)) }));
    const before = sum(await this.orders.findBy({ status: SOLD, createdAt: Between(new Date(params.previousFrom), new Date(params.previousTo)) }));
    return { value: now.toFixed(2), unit: fa(ctx) ? 'تومان' : 'Toman', change: percent(now, before), previousLabel: fa(ctx) ? 'نسبت به دوره قبل' : 'vs the previous period' };
  }
}

@AdminWidget('orders', { type: 'stat', title: { en: 'Orders', fa: 'سفارش‌ها' }, order: 20 })
class OrdersWidget implements AdminWidgetSource {
  constructor(@InjectRepository(Order) private readonly orders: Repository<Order>) {}
  async load(params: { from: string; to: string; previousFrom: string; previousTo: string }, ctx: AdminContext) {
    const now = await this.orders.countBy({ createdAt: Between(new Date(params.from), new Date(params.to)) });
    const before = await this.orders.countBy({ createdAt: Between(new Date(params.previousFrom), new Date(params.previousTo)) });
    return { value: String(now), change: percent(now, before), previousLabel: fa(ctx) ? 'نسبت به دوره قبل' : 'vs the previous period' };
  }
}

@AdminWidget('low-stock', { type: 'stat', title: { en: 'Low stock', fa: 'رو به اتمام' }, order: 30 })
class LowStockWidget implements AdminWidgetSource {
  constructor(@InjectRepository(Product) private readonly products: Repository<Product>) {}
  async load(_params: unknown, ctx: AdminContext) {
    return { value: String(await this.products.countBy({ stock: LessThanOrEqual(5) })), unit: fa(ctx) ? 'محصول' : 'products' };
  }
}

@AdminWidget('goal', { type: 'progress', title: { en: 'This month’s sales goal', fa: 'هدف فروش ماه' }, order: 40, permission: 'dashboard.sales' })
class GoalWidget implements AdminWidgetSource {
  constructor(@InjectRepository(Order) private readonly orders: Repository<Order>) {}
  async load(_params: unknown, ctx: AdminContext) {
    const goal = 5000;
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const sold = sum(await this.orders.findBy({ status: SOLD, createdAt: Between(start, new Date()) }));
    const share = Math.min(100, Math.round((sold / goal) * 100));
    return { percent: share, value: `${share}%`, caption: fa(ctx) ? `${sold.toFixed(0)} از ${goal} تومان` : `${sold.toFixed(0)} of ${goal} Toman` };
  }
}

@AdminWidget('daily-sales', { type: 'chart', title: { en: 'Sales by day', fa: 'نمودار فروش روزانه' }, order: 50, size: 3, permission: 'dashboard.sales' })
class DailySalesWidget implements AdminWidgetSource {
  constructor(@InjectRepository(Order) private readonly orders: Repository<Order>) {}
  async load(params: { from: string; to: string; previousFrom: string; previousTo: string }, ctx: AdminContext) {
    const days = Math.max(1, Math.round((Date.parse(params.to) - Date.parse(params.from)) / 86_400_000));
    const bucket = async (from: string) => {
      const start = Date.parse(from);
      const rows = await this.orders.findBy({ status: SOLD, createdAt: Between(new Date(start), new Date(start + days * 86_400_000)) });
      const values = Array.from({ length: days }, () => 0);
      for (const order of rows) values[Math.min(days - 1, Math.floor((order.createdAt.getTime() - start) / 86_400_000))]! += Number(order.total);
      return values;
    };
    const labels = Array.from({ length: days }, (_, index) => new Date(Date.parse(params.from) + index * 86_400_000).toLocaleDateString(fa(ctx) ? 'fa-IR' : 'en', { day: 'numeric', month: 'short' }));
    return {
      kind: 'line' as const,
      labels,
      series: [
        { label: fa(ctx) ? 'این دوره' : 'This period', values: await bucket(params.from) },
        { label: fa(ctx) ? 'دوره قبل' : 'Previous period', values: await bucket(params.previousFrom), dashed: true },
      ],
    };
  }
}

@AdminWidget('latest-orders', { type: 'table', title: { en: 'Latest orders', fa: 'آخرین سفارش‌ها' }, order: 60, size: 3, permission: 'dashboard.orders' })
class LatestOrdersWidget implements AdminWidgetSource {
  constructor(@InjectRepository(Order) private readonly orders: Repository<Order>) {}
  async load(_params: unknown, ctx: AdminContext) {
    const tones = { draft: 'warn', paid: 'info', shipped: 'ok', cancelled: 'neutral' } as const;
    const labels = { draft: ['Draft', 'پیش‌نویس'], paid: ['Paid', 'پرداخت‌شده'], shipped: ['Shipped', 'ارسال‌شده'], cancelled: ['Cancelled', 'لغوشده'] } as const;
    const rows = await this.orders.find({ order: { id: 'DESC' }, take: 6 });
    return {
      columns: [
        { key: 'number', label: fa(ctx) ? 'سفارش' : 'Order' },
        { key: 'customer', label: fa(ctx) ? 'مشتری' : 'Customer' },
        { key: 'total', label: fa(ctx) ? 'مبلغ' : 'Total' },
        { key: 'status', label: fa(ctx) ? 'وضعیت' : 'Status' },
      ],
      rows: rows.map((order) => ({ number: order.number, customer: order.customer, total: order.total, status: { label: labels[order.status][fa(ctx) ? 1 : 0], tone: tones[order.status] } })),
      link: { resource: 'order' },
    };
  }
}

@AdminWidget('restock', { type: 'list', title: { en: 'To restock', fa: 'نیاز به شارژ موجودی' }, order: 70, permission: 'dashboard.low-stock' })
class RestockWidget implements AdminWidgetSource {
  constructor(@InjectRepository(Product) private readonly products: Repository<Product>) {}
  async load(_params: unknown, ctx: AdminContext) {
    const rows = await this.products.find({ where: { stock: LessThanOrEqual(5) }, order: { stock: 'ASC' }, take: 5 });
    return { items: rows.map((product) => ({ icon: 'package', text: `${product.name} · ${product.stock} ${fa(ctx) ? 'عدد' : 'left'}`, status: product.stock === 0 ? ('bad' as const) : ('warn' as const), link: `/product/${product.id}` })) };
  }
}

/** The configured demo's dashboard: every widget type (spec §5.8). Superusers see them all. */
@Module({
  imports: [TypeOrmModule.forFeature([Order, Product])],
  providers: [SalesWidget, OrdersWidget, LowStockWidget, GoalWidget, DailySalesWidget, LatestOrdersWidget, RestockWidget],
})
export class DashboardModule {}
