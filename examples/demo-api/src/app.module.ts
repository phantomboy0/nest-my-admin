import { builtinAuth } from '@nest-my-admin/auth';
import { AdminModule, localStorage } from '@nest-my-admin/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from './billing/billing.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { ContentModule } from './content/content.module.js';
import { databaseOptions } from './database.js';
import { SalesModule } from './sales/sales.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { StaffModule } from './staff/staff.module.js';

@Module({
  imports: [
    // Async so DATABASE_URL is read at boot, not when this file is imported (tests set it per run).
    TypeOrmModule.forRootAsync({ useFactory: () => databaseOptions() }),
    AdminModule.forRoot({
      path: '/admin',
      title: { en: 'Demo shop', fa: 'فروشگاه نمونه' },
      locale: 'en',
      locales: ['en', 'fa'],
      branding: { primaryColor: '#0f766e' },
      // Sign in as admin / admin-demo-pass (or NMA_DEMO_PASSWORD) on a fresh database.
      // `editor` edits the catalog: products (drafts only, price read-only, no cost), categories and tags. They also
      // handle orders: they may ship them (`order.action.ship`, with `order.update`, which every action on a record
      // needs), but not mark them paid or cancel them, and they see the shop's settings without being able to save
      // them (`page.shop` without `page.shop.update`).
      roles: [
        {
          name: 'catalog-editor',
          label: { en: 'Catalog editor', fa: 'ویرایشگر کاتالوگ' },
          permissions: ['product.view', 'product.update', 'category.*', 'tag.*', 'stock-move.view', 'order.view', 'order.update', 'order.action.ship', 'page.shop'],
          fields: { product: { price: 'readonly' } },
          scopes: { product: { update: 'drafts' } },
        },
      ],
      resolveRoles: (user) => (user.username === 'editor' ? ['catalog-editor'] : []),
      // Roles, groups and users are also managed in the admin (Administration section; the seed adds a Support role).
      rbac: {},
      // Every change made through the admin, every sign-in and every permission change is recorded (`nma_audit`), and
      // entries older than a year are deleted. Records get a History tab; the audit page (user menu → Audit log) needs
      // `audit.view`, which the editor's role does not have: they see the history of the records they can open, no more.
      audit: { retentionDays: 365 },
      // Uploads of file, image and rich-text fields are kept on disk (git-ignored); tests point NMA_UPLOAD_DIR at a
      // temporary directory. Downloads go through the admin, which checks permissions for every file.
      files: { storage: localStorage({ dir: process.env.NMA_UPLOAD_DIR ?? 'var/uploads' }) },
      auth: builtinAuth({
        bootstrapSuperuser: { username: 'admin', password: process.env.NMA_DEMO_PASSWORD ?? 'admin-demo-pass', displayName: 'Demo Admin' },
        // Encrypts two-factor keys at rest: `openssl rand -base64 32`, kept out of the repository.
        ...(process.env.NMA_SECRET_KEY ? { secretKey: process.env.NMA_SECRET_KEY } : {}),
        issuer: 'Demo shop',
      }),
    }),
    CatalogModule,
    SalesModule,
    ContentModule,
    BillingModule,
    SettingsModule,
    StaffModule,
  ],
})
export class AppModule {}
