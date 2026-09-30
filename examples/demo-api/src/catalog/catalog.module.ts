import { AdminGroup } from '@nest-my-admin/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from './category.entity.js';
import { ProductAdmin } from './product.admin.js';
import { Product } from './product.entity.js';
import { ProductsService } from './products.service.js';
import { Tag } from './tag.entity.js';
import { CategoryAdmin, TagAdmin } from './taxonomy.admin.js';

@AdminGroup({ label: 'Catalog', icon: 'boxes' })
@Module({
  imports: [TypeOrmModule.forFeature([Product, Category, Tag])],
  providers: [ProductsService, ProductAdmin, CategoryAdmin, TagAdmin],
})
export class CatalogModule {}
