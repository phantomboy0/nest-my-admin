import { Module } from '@nestjs/common';
import { IsInt, IsString, Length } from 'class-validator';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { AdminResource, AdminResourceBase, type FormConfig } from '../../src/index.js';
import { Widget } from './widgets.js';

/** A foreign key whose column name differs from its property, and a unique constraint over two columns. */
@Entity()
@Unique('UQ_gadget_batch_serial', ['batch', 'serial'])
export class Gadget {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 20 }) batch: string;
  @Column({ length: 20 }) serial: string;
  @Column({ type: 'int', name: 'widget_id' }) widgetId: number;
  @ManyToOne(() => Widget, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'widget_id' }) widget: Widget;
}

export class GadgetDto {
  @IsString() @Length(1, 20) batch: string;
  @IsString() @Length(1, 20) serial: string;
  @IsInt() widgetId: number;
}

@AdminResource(Gadget)
export class GadgetAdmin extends AdminResourceBase<Gadget> {
  form: FormConfig = { create: GadgetDto };
}

@Module({ providers: [GadgetAdmin] })
export class GadgetsModule {}
