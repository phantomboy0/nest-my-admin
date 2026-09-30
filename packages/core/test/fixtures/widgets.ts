import { Module } from '@nestjs/common';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AdminGroup, AdminResource, AdminResourceBase, type ListConfig } from '../../src/index.js';

@Entity()
export class Widget {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 80 }) name: string;
  @Column({ type: 'decimal', precision: 10, scale: 2, default: '0.00' }) price: string;
  @Column({ type: 'simple-enum', enum: ['draft', 'live'], default: 'draft' }) status: 'draft' | 'live';
  @Column({ default: true }) visible: boolean;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @CreateDateColumn() createdAt: Date;
}

@AdminResource(Widget)
export class WidgetAdmin extends AdminResourceBase<Widget> {
  list: ListConfig<Widget> = {
    columns: ['id', 'name', 'price', 'status', 'visible'],
    filters: ['status', 'visible', 'price', 'notes', 'name', 'createdAt'],
    search: ['name', 'notes'],
  };
}

@AdminGroup({ label: 'Inventory', icon: 'boxes' })
@Module({ providers: [WidgetAdmin] })
export class WidgetsModule {}
