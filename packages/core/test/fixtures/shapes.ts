import { Module } from '@nestjs/common';
import { Column, Entity, PrimaryColumn } from 'typeorm';
import { AdminResource, AdminResourceBase, type ListConfig } from '../../src/index.js';

/** A composite primary key whose string part may contain the id separators. */
@Entity()
export class Line {
  @PrimaryColumn({ type: 'int' }) orderId: number;
  @PrimaryColumn({ length: 20 }) sku: string;
  @Column({ type: 'int', default: 1 }) qty: number;
}

/** A single string key, which may be "new". */
@Entity()
export class Keyed {
  @PrimaryColumn({ length: 20 }) code: string;
  @Column({ length: 40 }) label: string;
}

@AdminResource(Line)
export class LineAdmin extends AdminResourceBase<Line> {
  list: ListConfig<Line> = { columns: ['orderId', 'sku', 'qty'], sort: 'qty', pageSize: 2, filters: ['qty'] };
}

@AdminResource(Keyed)
export class KeyedAdmin extends AdminResourceBase<Keyed> {}

@Module({ providers: [LineAdmin, KeyedAdmin] })
export class ShapesModule {}

export const SHAPE_ENTITIES: Function[] = [Line, Keyed];
