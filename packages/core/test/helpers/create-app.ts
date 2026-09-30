import 'reflect-metadata';
import type { DynamicModule, INestApplication, Provider, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { fileURLToPath } from 'node:url';
import { AdminModule, type AdminModuleOptions } from '../../src/index.js';
import { Widget, WidgetsModule } from '../fixtures/widgets.js';
import { testDatabase, type TestDatabase } from './test-db.js';

export const FIXTURE_UI_DIST = fileURLToPath(new URL('../fixtures/ui-dist', import.meta.url));

export interface TestAppOptions {
  admin?: AdminModuleOptions;
  imports?: Array<Type | DynamicModule>;
  providers?: Provider[];
  entities?: Function[];
  /** Extra TypeORM options for the app's DataSource (a logger, for instance). */
  dataSource?: Record<string, unknown>;
  /** More DataSources, each on its own test database: `{ reports: [Report] }`. */
  dataSources?: Record<string, Function[]>;
  beforeInit?: (app: INestApplication) => void;
}

/** A Nest app on its own test database (see test-db.ts), with AdminModule (serving the fixture UI) and the Widgets module. */
export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication> {
  const db = await testDatabase([Widget, ...(options.entities ?? [])]);
  const extra: Array<{ name: string; db: TestDatabase }> = [];
  const dropAll = async () => {
    await db.drop();
    for (const { db: other } of extra) await other.drop();
  };
  let app: INestApplication | undefined;
  try {
    for (const [name, entities] of Object.entries(options.dataSources ?? {})) extra.push({ name, db: await testDatabase(entities) });
    const moduleRef = await Test.createTestingModule({
      imports: [
        // retryAttempts: 0 — a schema that cannot be created fails the test at once instead of retrying for 30 s
        TypeOrmModule.forRoot({ ...db.options, ...(options.dataSource as object), retryAttempts: 0 }),
        ...extra.map(({ name, db: other }) => TypeOrmModule.forRoot({ ...other.options, name, retryAttempts: 0 })),
        AdminModule.forRoot({ uiDistPath: FIXTURE_UI_DIST, ...options.admin }),
        WidgetsModule,
        ...(options.imports ?? []),
      ],
      providers: options.providers ?? [],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    options.beforeInit?.(app);
    await app.init();
  } catch (error) {
    await app?.close().catch(() => undefined);
    await dropAll();
    throw error;
  }
  const close = app.close.bind(app);
  app.close = async () => {
    try {
      await close();
    } finally {
      await dropAll();
    }
  };
  return app;
}
