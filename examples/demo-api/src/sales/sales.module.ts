import { AdminGroup } from '@nest-my-admin/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderAdmin } from './order.admin.js';
import { Order } from './order.entity.js';

@AdminGroup({ label: { en: 'Sales', fa: 'فروش' }, icon: 'shopping-bag' })
@Module({ imports: [TypeOrmModule.forFeature([Order])], providers: [OrderAdmin] })
export class SalesModule {}
