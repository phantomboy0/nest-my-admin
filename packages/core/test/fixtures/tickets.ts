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

@Module({ providers: [TicketAdmin, EstimatedTicketAdmin, UncountedTicketAdmin] })
export class TicketsModule {}

export const TICKET_ENTITIES: Function[] = [Ticket];

/** `count` tickets: priority `i % 5`, except priority 99 for the first three; titles `T0001`… */
export async function seedTickets(dataSource: DataSource, count: number): Promise<void> {
  const rows = Array.from({ length: count }, (_, i) => ({ title: `T${String(i + 1).padStart(4, '0')}`, priority: i < 3 ? 99 : i % 5, note: null }));
  for (let i = 0; i < rows.length; i += 200) {
    await dataSource.createQueryBuilder().insert().into(Ticket).values(rows.slice(i, i + 200)).updateEntity(false).execute();
  }
  const type = dataSource.options.type;
  if (type === 'postgres') await dataSource.query('ANALYZE ticket');
  if (type === 'mysql') await dataSource.query('ANALYZE TABLE ticket');
}
