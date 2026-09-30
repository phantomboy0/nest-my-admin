import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Column, Entity, PrimaryGeneratedColumn, type DataSource } from 'typeorm';
import { AdminResource, AdminResourceBase, AfterSave, ResourceRegistry, type AdminContext } from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';

@Entity()
class Report {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
}

@Entity()
class Metric {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
}

/** Another class named Widget, in the reports DataSource: its auto name collides with the default `widget`. */
const ReportsWidget = (() => {
  @Entity('report_widget')
  class Widget {
    @PrimaryGeneratedColumn() id: number;
    @Column({ length: 40 }) label: string;
  }
  return Widget;
})();

@AdminResource(Report, { dataSource: 'reports' })
class ReportAdmin extends AdminResourceBase<Report> {
  @AfterSave() refuse(report: Report, _ctx: AdminContext) {
    if (report.name === 'boom') throw new Error('refused after saving');
  }
}

@Module({ providers: [ReportAdmin] })
class ReportsModule {}

let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await createTestApp({
    imports: [ReportsModule],
    dataSources: { reports: [Report, Metric, ReportsWidget] },
    admin: { autoRegister: ['default', 'reports'] },
  });
});
afterAll(async () => {
  await app.close();
});

describe('several DataSources (Review Focus 4)', () => {
  test('a resource writes and reads through its own DataSource', async () => {
    expect((await http().post('/admin/api/resources/report').send({ name: 'Q1' })).status).toBe(201);
    const reports = app.get<DataSource>(getDataSourceToken('reports'));
    expect(await reports.getRepository(Report).count()).toBe(1);
    expect((await http().get('/admin/api/resources/report')).body.items.map((item: { name: string }) => item.name)).toEqual(['Q1']);
  });

  test('a failing write rolls back on that DataSource', async () => {
    const res = await http().post('/admin/api/resources/report').send({ name: 'boom' });
    expect(res.status).toBe(500);
    expect(await app.get<DataSource>(getDataSourceToken('reports')).getRepository(Report).countBy({ name: 'boom' })).toBe(0);
  });

  test('autoRegister covers each listed DataSource; a taken name gets the DataSource prefix', async () => {
    const registry = app.get(ResourceRegistry);
    const names = registry.list().map((entry) => entry.schema.name).sort();
    expect(names).toEqual(['metric', 'report', 'reports-widget', 'widget']);
    expect(registry.get('reports-widget').dataSource).toBe(app.get<DataSource>(getDataSourceToken('reports')));
    expect((await http().post('/admin/api/resources/reports-widget').send({ label: 'x' })).status).toBe(201);
    expect((await http().post('/admin/api/resources/metric').send({ name: 'visits' })).status).toBe(201);
  });
});
