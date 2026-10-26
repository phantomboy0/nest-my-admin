import { AdminGroup, AdminResource, AdminResourceBase, type FieldsConfig, type ListConfig } from '@nest-my-admin/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './invoice.entity.js';

@AdminResource(Invoice, { icon: 'receipt', label: { en: 'Invoice', fa: 'صورت‌حساب' }, title: 'number' })
export class InvoiceAdmin extends AdminResourceBase<Invoice> {
  list: ListConfig<Invoice> = { columns: ['id', 'number', 'customer', 'total', 'pdf'], sort: '-id', search: ['number', 'customer'] };
  fields: FieldsConfig<Invoice> = {
    number: { label: { en: 'Number', fa: 'شماره' } },
    customer: { label: { en: 'Customer', fa: 'مشتری' } },
    total: { widget: 'money', label: { en: 'Total', fa: 'جمع' } },
    // Private (the default): the download goes through the admin, which checks the invoice's permissions each time.
    pdf: { widget: 'file', label: { en: 'PDF', fa: 'فایل PDF' }, file: { accept: ['application/pdf'], maxBytes: 5 * 1024 * 1024 } },
  };
}

@AdminGroup({ label: { en: 'Billing', fa: 'صورت‌حساب‌ها' }, icon: 'wallet' })
@Module({ imports: [TypeOrmModule.forFeature([Invoice])], providers: [InvoiceAdmin] })
export class BillingModule {}
