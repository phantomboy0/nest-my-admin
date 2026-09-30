import 'reflect-metadata';
import type { DynamicModule, INestApplication, Provider, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { fileURLToPath } from 'node:url';
import { AdminModule, type AdminModuleOptions } from '../../src/index.js';
import { Widget, WidgetsModule } from '../fixtures/widgets.js';
import { testDatabase } from './test-db.js';

export const FIXTURE_UI_DIST = fileURLToPath(new URL('../fixtures/ui-dist', import.meta.url));

export interface TestAppOptions {
  admin?: AdminModuleOptions;
  imports?: Array<Type | DynamicModule>;
  providers?: Provider[];
  entities?: Function[];
  beforeInit?: (app: INestApplication) => void;
}

/** A Nest app on its own test database (see test-db.ts), with AdminModule (serving the fixture UI) and the Widgets module. */
export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication> {
  const db = await testDatabase([Widget, ...(options.entities ?? [])]);
  let app: INestApplication | undefined;
  try {
    const moduleRef = await Test.createTestingModule({
      imports: [
        // retryAttempts: 0 — a schema that cannot be created fails the test at once instead of retrying for 30 s
        TypeOrmModule.forRoot({ ...db.options, retryAttempts: 0 }),
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
    await db.drop();
    throw error;
  }
  const close = app.close.bind(app);
  app.close = async () => {
    try {
      await close();
    } finally {
      await db.drop();
    }
  };
  return app;
}
