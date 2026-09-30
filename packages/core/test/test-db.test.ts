import 'reflect-metadata';
import { afterAll, describe, expect, test } from 'bun:test';
import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AdminResource, AdminResourceBase } from '../src/index.js';
import { Widget } from './fixtures/widgets.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB, sweepStaleDatabases, testDatabase, testDatabaseNames, type TestDatabase } from './helpers/test-db.js';

describe.skipIf(TEST_DB === 'sqljs')(`test databases (${TEST_DB})`, () => {
  const db = TEST_DB as 'postgres' | 'mysql';
  const leftovers: TestDatabase[] = [];
  afterAll(async () => {
    for (const database of leftovers) await database.drop();
  });

  test('each call creates its own empty database and drop() removes it', async () => {
    const first = await testDatabase([Widget]);
    const second = await testDatabase([Widget]);
    leftovers.push(first, second);
    expect(first.url).not.toBe(second.url);
    const connection = await new DataSource(first.options).initialize();
    await connection.getRepository(Widget).save({ name: 'only in first' });
    await connection.destroy();
    const other = await new DataSource(second.options).initialize();
    expect(await other.getRepository(Widget).count()).toBe(0);
    await other.destroy();

    const name = new URL(first.url!).pathname.slice(1);
    expect(await testDatabaseNames(db)).toContain(name);
    await first.drop();
    expect(await testDatabaseNames(db)).not.toContain(name);
  });

  test('sweeping drops databases of dead processes and keeps live ones (Review Focus 1)', async () => {
    const live = await testDatabase([]);
    leftovers.push(live);
    const liveName = new URL(live.url!).pathname.slice(1);
    const deadName = 'nma_t_2147483646_deadbeef'; // no process has this pid
    const server = new DataSource({ type: db, url: db === 'postgres' ? 'postgres://postgres:nma@127.0.0.1:55432/postgres' : 'mysql://root:nma@127.0.0.1:53306/mysql' });
    await server.initialize();
    await server.query(db === 'postgres' ? `CREATE DATABASE "${deadName}"` : `CREATE DATABASE \`${deadName}\``);
    await server.destroy();

    expect(await sweepStaleDatabases(db)).toContain(deadName);
    const names = await testDatabaseNames(db);
    expect(names).not.toContain(deadName);
    expect(names).toContain(liveName);
  });

  test('an app that fails to boot drops its database at once (Review Focus 2)', async () => {
    class Broken {}
    @AdminResource(Broken)
    class BrokenAdmin extends AdminResourceBase {}
    @Module({ providers: [BrokenAdmin] })
    class BrokenModule {}
    const before = await testDatabaseNames(db);
    const started = Date.now();
    await expect(createTestApp({ imports: [BrokenModule] })).rejects.toThrow('entity Broken is not registered');
    expect(Date.now() - started).toBeLessThan(3000);
    expect(await testDatabaseNames(db)).toEqual(before);
  });
});

test('sqljs needs no server', async () => {
  if (TEST_DB !== 'sqljs') return;
  const database = await testDatabase([Widget]);
  expect(database.options.type).toBe('sqljs');
  expect(database.url).toBeUndefined();
  await database.drop();
});
