import { AdminGroup } from '@nest-my-admin/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductAdmin } from './product.admin.js';
import { Product } from './product.entity.js';
import { ProductsService } from './products.service.js';

@AdminGroup({ label: 'Catalog', icon: 'boxes' })
@Module({
  imports: [TypeOrmModule.forFeature([Product])],
  providers: [ProductsService, ProductAdmin],
})
export class CatalogModule {}
