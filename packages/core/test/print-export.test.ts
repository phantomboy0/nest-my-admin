import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, ConflictException, type INestApplication } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { inflateRawSync } from 'node:zlib';
import request from 'supertest';
import { Column, CreateDateColumn, DataSource, Entity, ManyToOne, PrimaryGeneratedColumn, JoinColumn } from 'typeorm';
import {
  ADMIN_AUDIT_ENTITIES,
  AdminAuth,
  AdminPrint,
  AdminResource,
  AdminResourceBase,
  AdminScope,
  html,
  type AdminAuthAdapter,
  type AdminContext,
  type AdminPrincipal,
  type AdminUser,
  type ListConfig,
  type ResourceSchema,
} from '../src/index.js';
import { resolvePrints } from '../src/decorators/admin-print.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

@Entity('pe_customer')
class Customer {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 60 }) name: string;
}

@Entity('pe_invoice')
class Invoice {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 20 }) number: string;
  @Column({ type: 'int', nullable: true }) customerId: number | null;
  @ManyToOne(() => Customer, { nullable: true }) @JoinColumn({ name: 'customerId' }) customer: Customer | null;
  @Column({ type: 'decimal', precision: 12, scale: 2 }) total: string;
  @Column({ type: 'boolean', default: false }) paid: boolean;
  @Column({ type: 'simple-enum', enum: ['draft', 'sent'], default: 'draft' }) status: string;
  @Column({ type: 'varchar', length: 60, default: '' }) secret: string;
  @Column({ type: 'varchar', length: 20 }) owner: string;
  @CreateDateColumn() createdAt: Date;
}

@AdminResource(Customer, { title: 'name' })
class CustomerAdmin extends AdminResourceBase<Customer> {}

@AdminResource(Invoice, { title: 'number' })
class InvoiceAdmin extends AdminResourceBase<Invoice> {
  list: ListConfig<Invoice> = { columns: ['number', 'customerId', 'total', 'paid', 'status', 'secret', 'createdAt'], filters: ['status'], search: ['number'], sort: 'number', export: { max: 3 } };
  fields = { status: { enumLabels: { draft: 'Draft', sent: { en: 'Sent', fa: 'ارسال‌شده' } } } };

  @AdminPrint({ label: { en: 'Invoice', fa: 'فاکتور' }, bulk: true })
  invoice(invoices: Invoice[]) {
    return html`${invoices.map((invoice) => html`<section class="nma-print-page"><h1>${invoice.number}</h1></section>`)}`;
  }

  @AdminPrint({ paper: 'label' })
  label(invoices: Invoice[]) {
    if (invoices[0]!.status !== 'sent') throw new ConflictException('Only sent invoices get a label');
    return html`<p>${invoices[0]!.number}</p>`;
  }

  @AdminScope('own') own(ctx: AdminContext) {
    return { owner: String(ctx.user?.id) };
  }
}

const USERS: Record<string, AdminUser> = {
  root: { id: 'root', displayName: 'Root', isSuperuser: true },
  clerk: { id: 'clerk', displayName: 'Clerk', isSuperuser: false },
  viewer: { id: 'viewer', displayName: 'Viewer', isSuperuser: false },
};
const ROLES_OF: Record<string, string[]> = { clerk: ['clerk'], viewer: ['viewer'] };

@Injectable()
class HeaderAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = USERS[String(req.headers['x-user'] ?? '')];
    return user ? { user } : null;
  }
  resolveRoles(user: AdminUser) {
    return ROLES_OF[String(user.id)] ?? [];
  }
}

@Module({ providers: [HeaderAuth, CustomerAdmin, InvoiceAdmin] })
class InvoicesModule {}

let app: INestApplication;
const get = (user: string, path: string, locale = 'en') => request(app.getHttpServer()).get(`/admin/api${path}`).set('X-User', user).set('Accept-Language', locale);
const ids: string[] = [];

function sheetOf(buffer: Buffer): string {
  let at = 0;
  while (buffer.readUInt32LE(at) === 0x04034b50) {
    const size = buffer.readUInt32LE(at + 18);
    const nameLength = buffer.readUInt16LE(at + 26);
    const name = buffer.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    if (name === 'xl/worksheets/sheet1.xml') return inflateRawSync(buffer.subarray(at + 30 + nameLength, at + 30 + nameLength + size)).toString('utf8');
    at += 30 + nameLength + size;
  }
  throw new Error('no sheet');
}
const binary = (res: request.Response, callback: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

beforeAll(async () => {
  app = await createTestApp({
    imports: [InvoicesModule],
    entities: [Customer, Invoice, ...ADMIN_AUDIT_ENTITIES],
    admin: {
      locales: ['en', 'fa'],
      auth: AdminAuth.custom(HeaderAuth),
      audit: {},
      roles: [
        { name: 'clerk', permissions: ['invoice.view', 'customer.view', 'invoice.print.invoice', 'invoice.export'], fields: { invoice: { secret: 'hidden' } }, scopes: { invoice: { view: 'own' } } },
        { name: 'viewer', permissions: ['invoice.view'] },
      ],
    },
  });
  const db = app.get(DataSource);
  const repo = db.getRepository(Invoice);
  const sara = await db.getRepository(Customer).save({ name: 'Sara' });
  for (const [number, owner, status, total] of [['A-1', 'clerk', 'sent', '1250.50'], ['A-2', 'clerk', 'draft', '10'], ['A-3', 'root', 'sent', '99'], ['A-4', 'clerk', 'sent', '7'], ['A-5', 'clerk', 'sent', '8']] as const) {
    ids.push(String((await repo.save({ number, owner, status, total, customerId: sara.id, secret: 'S3CRET', paid: number === 'A-1' })).id));
  }
});
afterAll(async () => {
  await app?.close();
});

describe(`printing records (${TEST_DB})`, () => {
  test('the schema lists the templates a user may print', async () => {
    expect(((await get('root', '/meta/resources/invoice')).body as ResourceSchema).prints).toEqual([
      { name: 'invoice', label: 'Invoice', bulk: true },
      { name: 'label', label: 'Label', bulk: false },
    ]);
    expect(((await get('clerk', '/meta/resources/invoice', 'fa')).body as ResourceSchema).prints).toEqual([{ name: 'invoice', label: 'فاکتور', bulk: true }]);
    expect(((await get('viewer', '/meta/resources/invoice')).body as ResourceSchema).prints).toEqual([]);
  });

  test('a page that prints itself: sized, escaped body, nonce script, no-store', async () => {
    const res = await get('root', `/resources/invoice/print/invoice?id=${ids[0]}&id=${ids[1]}`, 'fa');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toMatch(/script-src 'nonce-[^']+'/);
    expect(res.text).toContain('<html lang="fa" dir="rtl">');
    expect(res.text).toContain('@page { size: A4;');
    expect(res.text).toContain('<h1>A-1</h1></section><section class="nma-print-page"><h1>A-2</h1>');
    expect((await get('root', `/resources/invoice/print/label?id=${ids[0]}`)).text).toContain('@page { size: 100mm 150mm;');
  });

  test('refusals: permission, scope, one record only, missing id, unknown template, host refusal', async () => {
    expect((await get('viewer', `/resources/invoice/print/invoice?id=${ids[0]}`)).status).toBe(403);
    expect((await get('clerk', `/resources/invoice/print/invoice?id=${ids[2]}`)).status).toBe(404); // root's invoice
    expect((await get('root', `/resources/invoice/print/label?id=${ids[0]}&id=${ids[2]}`)).status).toBe(400);
    expect((await get('root', '/resources/invoice/print/invoice')).status).toBe(400);
    expect((await get('root', `/resources/invoice/print/nope?id=${ids[0]}`)).status).toBe(404);
    const refused = await get('root', `/resources/invoice/print/label?id=${ids[1]}`);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe('Only sent invoices get a label');
  });

  test('each printed record is audited', async () => {
    await get('clerk', `/resources/invoice/print/invoice?id=${ids[3]}`);
    const history = await get('root', `/resources/invoice/${ids[3]}/history`);
    expect(history.body.entries.map((entry: { event: string }) => entry.event)).toContain('invoice.print.invoice');
  });

  test('boot checks', () => {
    class Admin extends AdminResourceBase<Invoice> {
      @AdminPrint() markPaid() {
        return '';
      }
    }
    expect(() => resolvePrints(Admin, ['markPaid'], (message) => {
      throw new Error(message);
    })).toThrow(/the name is taken/);
  });
});

describe(`exporting lists (${TEST_DB})`, () => {
  test('the schema offers export only with the code', async () => {
    expect(((await get('clerk', '/meta/resources/invoice')).body as ResourceSchema).list.export).toEqual({ max: 3 });
    expect(((await get('viewer', '/meta/resources/invoice')).body as ResourceSchema).list.export).toBeUndefined();
    expect((await get('viewer', '/resources/invoice/export')).status).toBe(403);
    expect((await get('root', '/resources/customer/export')).status).toBe(404);
  });

  test('the workbook: the list query, the user scopes, hidden fields left out, labels and cells', async () => {
    const res = await get('clerk', '/resources/invoice/export?filter[status]=sent&sort=-number&offset=210', 'fa').buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="invoice-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    const sheet = sheetOf(res.body as Buffer);
    expect(sheet).toContain('rightToLeft="1"');
    // The clerk's sent invoices, newest number first; root's A-3 and the draft A-2 are not there.
    const numbers = [...sheet.matchAll(/<c r="A\d+" t="inlineStr"><is><t xml:space="preserve">(A-\d)<\/t>/g)].map((match) => match[1]);
    expect(numbers).toEqual(['A-5', 'A-4', 'A-1']);
    expect(sheet).not.toContain('S3CRET');
    expect(sheet).toContain('>Sara<');
    expect(sheet).toContain('<v>1250.5</v>');
    expect(sheet).toContain('>بله<');
    expect(sheet).toContain('>ارسال‌شده<');
  });

  test('max cuts the rows and says so; the export is audited', async () => {
    const res = await get('root', '/resources/invoice/export').buffer(true).parse(binary);
    expect(res.headers['x-export-truncated']).toBe('3');
    expect([...sheetOf(res.body as Buffer).matchAll(/<row /g)]).toHaveLength(4);
    const audit = await get('root', '/audit?event=invoice.export');
    expect(audit.status).toBe(200);
    expect(JSON.stringify(audit.body)).toContain('invoice.export');
  });

  test('a bad query is refused like the list refuses it', async () => {
    expect((await get('clerk', '/resources/invoice/export?filter[secret]=x')).status).toBe(422);
    expect((await get('clerk', '/resources/invoice/export?offset=9999')).status).toBe(422);
  });
});
