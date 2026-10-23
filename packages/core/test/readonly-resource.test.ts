import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { AdminAction, AdminResource, AdminResourceBase, type ActionOutcome, type AdminContext } from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

@Entity('ro_ticket')
class Ticket {
  @PrimaryGeneratedColumn() id: number;
  @Column() subject: string;
  @Column({ default: 'open' }) state: string;
}

@Entity('ro_ticket_event')
class TicketEvent {
  @PrimaryGeneratedColumn() id: number;
  @Column() ticketId: number;
  @ManyToOne(() => Ticket, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'ticketId' }) ticket: Ticket;
  @Column() what: string;
}

@AdminResource(TicketEvent, { name: 'ticket-event', readonly: true })
class TicketEventAdmin extends AdminResourceBase<TicketEvent> {}

/** A snapshot record the host writes; the admin only reads it and runs its action. */
@AdminResource(Ticket, { readonly: true })
class TicketAdmin extends AdminResourceBase<Ticket> {
  override list = { editable: ['state'] as Array<keyof Ticket & string> };
  override form = { layout: [{ fields: ['subject', 'state'] }, { inline: TicketEventAdmin, fields: ['what'] }] };

  @AdminAction()
  async close(ticket: Ticket, _input: unknown, ctx: AdminContext): Promise<ActionOutcome> {
    await this.repositoryFor(ctx).update(ticket.id, { state: 'closed' });
    return {};
  }
}

@Module({ providers: [TicketAdmin, TicketEventAdmin] })
class TicketModule {}

let app: INestApplication;
let db: DataSource;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await createTestApp({ imports: [TicketModule], entities: [Ticket, TicketEvent] });
  db = app.get(getDataSourceToken());
});
afterAll(async () => {
  await app.close();
});

describe(`read-only resources (${TEST_DB})`, () => {
  test('the schema offers no writes: not creatable, no update, delete or purge, no editable cells; actions stay', async () => {
    const schema = (await http().get('/admin/api/meta/resources/ticket')).body;
    expect(schema).toMatchObject({ readonly: true, creatable: false, permissions: { create: false, update: false, delete: false, purge: false } });
    expect(schema.list.editable).toEqual([]);
    expect(schema.form.create).toEqual([]);
    expect(schema.form.update).toEqual([]);
    expect(schema.actions.map((action: { name: string }) => action.name)).toEqual(['close']);
    expect(schema.inlines['ticket-event'].permissions).toEqual({ create: false, update: false, delete: false, purge: false });
  });

  test('the API refuses every write with 403; an action still runs', async () => {
    const ticket = await db.getRepository(Ticket).save({ subject: 'Broken' });
    await db.getRepository(TicketEvent).save({ ticketId: ticket.id, what: 'opened' });
    expect((await http().post('/admin/api/resources/ticket').send({ subject: 'x' })).status).toBe(403);
    expect((await http().patch(`/admin/api/resources/ticket/${ticket.id}`).send({ subject: 'x' })).status).toBe(403);
    expect((await http().delete(`/admin/api/resources/ticket/${ticket.id}`)).status).toBe(403);
    const inline = await http().patch(`/admin/api/resources/ticket/${ticket.id}`).send({ _inlines: { 'ticket-event': { create: [{ _key: 'a', what: 'x' }] } } });
    expect(inline.status).toBe(403);
    expect((await http().post('/admin/api/resources/ticket/actions/close').send({ ids: [String(ticket.id)] })).status).toBe(200);
    expect(await db.getRepository(Ticket).findOneByOrFail({ id: ticket.id })).toMatchObject({ subject: 'Broken', state: 'closed' });
    expect(await db.getRepository(TicketEvent).countBy({ ticketId: ticket.id })).toBe(1);
  });

  test('a child inlined in a read-only parent says so in its own schema', async () => {
    const meta = (await http().get('/admin/api/meta/resources/ticket-event')).body;
    expect(meta.readonly).toBe(true);
  });
});
