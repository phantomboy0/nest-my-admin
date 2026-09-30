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
    }),
    CatalogModule,
  ],
})
export class AppModule {}
