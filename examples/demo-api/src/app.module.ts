import { AdminModule } from '@nest-my-admin/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from './catalog/catalog.module.js';
import { databaseOptions } from './database.js';

@Module({
  imports: [
    // Async so DATABASE_URL is read at boot, not when this file is imported (tests set it per run).
    TypeOrmModule.forRootAsync({ useFactory: () => databaseOptions() }),
    AdminModule.forRoot({ path: '/admin', title: 'Demo shop' }),
    CatalogModule,
  ],
})
export class AppModule {}
