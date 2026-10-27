import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import {
  ADMIN_RBAC_ENTITIES,
  AdminAuth,
  AdminWidget,
  type AdminAuthAdapter,
  type AdminPrincipal,
  type AdminUserRecord,
  type AdminWidgetSource,
  type DashboardResponse,
  type WidgetParams,
} from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

let seen: WidgetParams | undefined;

@AdminWidget('sales', { type: 'stat', title: { en: 'Sales', fa: 'فروش' }, order: 10 })
class SalesWidget implements AdminWidgetSource {
  async load(params: WidgetParams) {
    seen = params;
    return { value: '1200', unit: 'Toman', change: 12.5 };
  }
}

@AdminWidget('orders', { type: 'chart', title: 'Orders', order: 20, size: 2, permission: 'reports.sales' })
class OrdersWidget implements AdminWidgetSource {
  async load() {
    return { kind: 'bar' as const, labels: ['Mon', 'Tue'], series: [{ label: 'This week', values: [3, 5] }] };
  }
}

@AdminWidget('revenue', { type: 'progress', title: 'Revenue', order: 30, permission: 'reports.sales' })
class RevenueWidget implements AdminWidgetSource {
  async load() {
    return { percent: 64, value: '64%', caption: 'of the monthly goal' };
  }
}

@AdminWidget('broken', { type: 'list', title: 'Broken', order: 40 })
class BrokenWidget implements AdminWidgetSource {
  async load(): Promise<never> {
    throw new Error('the report service is down');
  }
}

const users = new Map<string, AdminUserRecord>(['root', 'all', 'reports', 'none'].map((id) => [id, { id, displayName: id, username: id, isSuperuser: id === 'root', isActive: true }]));
@Injectable()
class TestAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = users.get(String(req.headers['x-user'] ?? ''));
    return user ? { user } : null;
  }
  resolveRoles(user: { id: string | number }) {
    return user.id === 'root' ? [] : [String(user.id)];
  }
  async getUser(id: string) {
    return users.get(id) ?? null;
  }
}

@Module({ providers: [TestAuth, SalesWidget, OrdersWidget, RevenueWidget, BrokenWidget] })
class DashboardModule {}

let app: INestApplication;
const get = (user: string, path: string, locale = 'en') => request(app.getHttpServer()).get(`/admin/api${path}`).set('X-User', user).set('Accept-Language', locale);
const PERIOD = new URLSearchParams({ period: 'week', from: '2026-10-19T00:00:00.000Z', to: '2026-10-26T00:00:00.000Z', previousFrom: '2026-10-12T00:00:00.000Z', previousTo: '2026-10-19T00:00:00.000Z' });

beforeAll(async () => {
  app = await createTestApp({
    imports: [DashboardModule],
    entities: [...ADMIN_RBAC_ENTITIES],
    admin: {
      auth: AdminAuth.custom(TestAuth),
      rbac: {},
      locales: ['en', 'fa'],
      permissions: ['reports.sales'],
      roles: [
        { name: 'all', permissions: ['dashboard.*'] },
        // One shared code: both widgets that name it.
        { name: 'reports', permissions: ['reports.sales'] },
        { name: 'none', permissions: ['widget.view'] },
      ],
    },
  });
});
afterAll(async () => {
  await app.close();
});

describe(`dashboard (${TEST_DB})`, () => {
  test('widgets are discovered and ordered; titles follow the language', async () => {
    const layout = (await get('root', '/dashboard', 'fa')).body as DashboardResponse;
    expect(layout.widgets).toEqual([
      { name: 'sales', type: 'stat', title: 'فروش', size: 1 },
      { name: 'orders', type: 'chart', title: 'Orders', size: 2 },
      { name: 'revenue', type: 'progress', title: 'Revenue', size: 1 },
      { name: 'broken', type: 'list', title: 'Broken', size: 1 },
    ]);
  });

  test('a widget loads for a valid period, which reaches it as given', async () => {
    const res = await get('root', `/dashboard/sales?${PERIOD}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ value: '1200', unit: 'Toman', change: 12.5 });
    expect(seen).toEqual({ period: 'week', from: '2026-10-19T00:00:00.000Z', to: '2026-10-26T00:00:00.000Z', previousFrom: '2026-10-12T00:00:00.000Z', previousTo: '2026-10-19T00:00:00.000Z' });
  });

  test('an unknown period, a reversed one or one over 366 days is a 400', async () => {
    const bad = (changes: Record<string, string>) => get('root', `/dashboard/sales?${new URLSearchParams({ ...Object.fromEntries(PERIOD), ...changes })}`);
    expect((await bad({ period: 'decade' })).status).toBe(400);
    expect((await bad({ from: '2026-10-26T00:00:00.000Z' })).status).toBe(400);
    expect((await bad({ from: '2025-10-01T00:00:00.000Z' })).status).toBe(400);
    expect((await bad({ to: 'yesterday' })).status).toBe(400);
  });

  test('permissions: dashboard.* and * grant every widget; a shared code grants both its widgets; without one, absent and 404', async () => {
    expect(((await get('all', '/dashboard')).body as DashboardResponse).widgets.map((widget) => widget.name)).toEqual(['sales', 'broken']);
    expect(((await get('reports', '/dashboard')).body as DashboardResponse).widgets.map((widget) => widget.name)).toEqual(['orders', 'revenue']);
    expect((await get('reports', `/dashboard/sales?${PERIOD}`)).status).toBe(404);
    expect((await get('reports', `/dashboard/orders?${PERIOD}`)).status).toBe(200);
    expect(((await get('root', '/dashboard')).body as DashboardResponse).widgets).toHaveLength(4);
  });

  test('meta says whether the user has a dashboard', async () => {
    expect((await get('reports', '/meta')).body.dashboard).toBe(true);
    expect((await get('none', '/meta')).body.dashboard).toBe(false);
    expect(((await get('none', '/dashboard')).body as DashboardResponse).widgets).toEqual([]);
  });

  test('a widget that fails answers its own error; the others still load', async () => {
    expect((await get('root', `/dashboard/broken?${PERIOD}`)).status).toBe(500);
    expect((await get('root', `/dashboard/revenue?${PERIOD}`)).body).toEqual({ percent: 64, value: '64%', caption: 'of the monthly goal' });
  });

  test('roles may name widget codes; the role editor lists them', async () => {
    const catalog = await get('root', '/rbac/catalog');
    expect(catalog.body.global).toEqual(expect.arrayContaining(['dashboard.sales', 'dashboard.broken', 'reports.sales']));
  });
});
