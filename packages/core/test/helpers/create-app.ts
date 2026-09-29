import 'reflect-metadata';
import type { DynamicModule, INestApplication, Provider, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { fileURLToPath } from 'node:url';
import { AdminModule, type AdminModuleOptions } from '../../src/index.js';
import { Widget, WidgetsModule } from '../fixtures/widgets.js';

export const FIXTURE_UI_DIST = fileURLToPath(new URL('../fixtures/ui-dist', import.meta.url));

export interface TestAppOptions {
  admin?: AdminModuleOptions;
  imports?: Array<Type | DynamicModule>;
  providers?: Provider[];
  entities?: Function[];
  beforeInit?: (app: INestApplication) => void;
}

/** A Nest app with sql.js, AdminModule (serving the fixture UI) and the Widgets module. */
export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({ type: 'sqljs', entities: [Widget, ...(options.entities ?? [])], synchronize: true }),
      AdminModule.forRoot({ uiDistPath: FIXTURE_UI_DIST, ...options.admin }),
      WidgetsModule,
      ...(options.imports ?? []),
    ],
    providers: options.providers ?? [],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  options.beforeInit?.(app);
  await app.init();
  return app;
}
