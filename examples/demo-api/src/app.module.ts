import { AdminModule } from '@nest-my-admin/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from './catalog/catalog.module.js';
import { Product } from './catalog/product.entity.js';

@Module({
  imports: [
    TypeOrmModule.forRoot({ type: 'sqljs', entities: [Product], synchronize: true }),
    AdminModule.forRoot({ path: '/admin', title: 'Demo shop' }),
    CatalogModule,
  ],
})
export class AppModule {}
