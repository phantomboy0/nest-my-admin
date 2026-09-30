import { Module } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AdminResource, AdminResourceBase, type ListConfig } from '../../src/index.js';

@Entity()
export class Ticket {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) title: string;
  /** Few distinct values, so sorting by it has many ties. */
  @Column({ type: 'int' }) priority: number;
  @Column({ type: 'varchar', length: 20, nullable: true }) note: string | null;
  /** Whole minutes, 50 distinct values: ties again. */
  @Column() openedAt: Date;
}

@AdminResource(Ticket)
export class TicketAdmin extends AdminResourceBase<Ticket> {
  list: ListConfig<Ticket> = { filters: ['priority'] };
}

@AdminResource(Ticket, { name: 'ticket-estimate' })
export class EstimatedTicketAdmin extends AdminResourceBase<Ticket> {
  list: ListConfig<Ticket> = { count: 'estimate', filters: ['priority'] };
}

@AdminResource(Ticket, { name: 'ticket-none' })
export class UncountedTicketAdmin extends AdminResourceBase<Ticket> {
  list: ListConfig<Ticket> = { count: 'none', pageSize: 10, filters: ['priority'] };
}

@AdminResource(Ticket, { name: 'ticket-keyset' })
export class KeysetTicketAdmin extends AdminResourceBase<Ticket> {
  list: ListConfig<Ticket> = { pagination: 'keyset', pageSize: 7, filters: ['priority'], sort: 'priority' };
}

@Module({ providers: [TicketAdmin, EstimatedTicketAdmin, UncountedTicketAdmin, KeysetTicketAdmin] })
export class TicketsModule {}

export const TICKET_ENTITIES: Function[] = [Ticket];

/** `count` tickets: priority `i % 5`, except priority 99 for the first three; titles `T0001`… */
export async function seedTickets(dataSource: DataSource, count: number): Promise<void> {
  const start = Date.UTC(2026, 0, 1);
  const rows = Array.from({ length: count }, (_, i) => ({
    title: `T${String(i + 1).padStart(4, '0')}`,
    priority: i < 3 ? 99 : i % 5,
    note: null,
    openedAt: new Date(start + (i % 50) * 60_000),
  }));
  for (let i = 0; i < rows.length; i += 200) {
    await dataSource.createQueryBuilder().insert().into(Ticket).values(rows.slice(i, i + 200)).updateEntity(false).execute();
  }
  const type = dataSource.options.type;
  if (type === 'postgres') await dataSource.query('ANALYZE ticket');
  if (type === 'mysql') await dataSource.query('ANALYZE TABLE ticket');
}
