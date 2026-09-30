import { builtinAuth } from '@nest-my-admin/auth';
import { AdminModule } from '@nest-my-admin/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from './catalog/catalog.module.js';
import { databaseOptions } from './database.js';

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
      // `editor` edits the catalog: products (drafts only, price read-only, no cost), categories and tags.
      roles: [
        {
          name: 'catalog-editor',
          label: { en: 'Catalog editor', fa: 'ویرایشگر کاتالوگ' },
          permissions: ['product.view', 'product.update', 'category.*', 'tag.*', 'stock-move.view'],
          fields: { product: { price: 'readonly' } },
          scopes: { product: { update: 'drafts' } },
        },
      ],
      resolveRoles: (user) => (user.username === 'editor' ? ['catalog-editor'] : []),
      auth: builtinAuth({ bootstrapSuperuser: { username: 'admin', password: process.env.NMA_DEMO_PASSWORD ?? 'admin-demo-pass', displayName: 'Demo Admin' } }),
    }),
    CatalogModule,
  ],
})
export class AppModule {}
