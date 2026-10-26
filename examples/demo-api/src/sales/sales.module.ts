import { AdminGroup } from '@nest-my-admin/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderAdmin } from './order.admin.js';
import { Order } from './order.entity.js';
import { OrderLineAdmin } from './order-line.admin.js';
import { OrderLine } from './order-line.entity.js';
import { OrderStatusLogAdmin } from './order-status-log.admin.js';
import { OrderStatusLog } from './order-status-log.entity.js';

@AdminGroup({ label: { en: 'Sales', fa: 'فروش' }, icon: 'shopping-bag' })
// The status log is a resource of the configured demo only (the plain one keeps its sidebar as it was).
@Module({
  imports: [TypeOrmModule.forFeature([Order, OrderLine, OrderStatusLog])],
  providers: [OrderAdmin, OrderLineAdmin, ...(process.env.NMA_DEMO_PLAIN === '1' ? [] : [OrderStatusLogAdmin])],
})
export class SalesModule {}
