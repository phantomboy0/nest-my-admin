import { AdminGroup } from '@nest-my-admin/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from './category.entity.js';
import { ProductAdmin } from './product.admin.js';
import { Product } from './product.entity.js';
import { ProductsService } from './products.service.js';
import { Tag } from './tag.entity.js';
import { Supplier } from './supplier.entity.js';
import { StockMove } from './stock-move.entity.js';
import { CategoryAdmin, StockMoveAdmin, SupplierAdmin, TagAdmin } from './taxonomy.admin.js';

@AdminGroup({ label: { en: 'Catalog', fa: 'کاتالوگ' }, icon: 'boxes' })
@Module({
  imports: [TypeOrmModule.forFeature([Product, Category, Tag, Supplier, StockMove])],
  providers: [ProductsService, ProductAdmin, CategoryAdmin, TagAdmin, SupplierAdmin, StockMoveAdmin],
})
export class CatalogModule {}
