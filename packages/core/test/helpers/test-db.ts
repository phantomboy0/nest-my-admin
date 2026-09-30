import { randomBytes } from 'node:crypto';
import { DataSource, type DataSourceOptions } from 'typeorm';

export type TestDb = 'sqljs' | 'postgres' | 'mysql';
type Server = Exclude<TestDb, 'sqljs'>;

const SERVER_URLS: Record<Server, string> = {
  postgres: process.env.NMA_TEST_POSTGRES_URL ?? 'postgres://postgres:nma@127.0.0.1:55432/postgres',
  mysql: process.env.NMA_TEST_MYSQL_URL ?? 'mysql://root:nma@127.0.0.1:53306/mysql',
};

function parseTestDb(raw: string | undefined): TestDb {
  if (raw === undefined || raw === '' || raw === 'sqljs') return 'sqljs';
  if (raw === 'postgres' || raw === 'mysql') return raw;
  throw new Error(`NMA_TEST_DB must be sqljs, postgres or mysql (got "${raw}")`);
}

/** Where integration tests run: `NMA_TEST_DB=postgres|mysql` (servers from `bun run db:up`); default sql.js in memory. */
export const TEST_DB: TestDb = parseTestDb(process.env.NMA_TEST_DB);

export interface TestDatabase {
  options: DataSourceOptions;
  /** Connection URL of the new database; undefined for sql.js. */
  url?: string;
  drop(): Promise<void>;
}

const quote = (db: Server, name: string) => (db === 'postgres' ? `"${name}"` : `\`${name}\``);
const dropSql = (db: Server, name: string) =>
  `DROP DATABASE IF EXISTS ${quote(db, name)}${db === 'postgres' ? ' WITH (FORCE)' : ''}`;

async function withServer<T>(db: Server, work: (server: DataSource) => Promise<T>): Promise<T> {
  const server = new DataSource({ type: db, url: SERVER_URLS[db] } as DataSourceOptions);
  await server.initialize();
  try {
    return await work(server);
  } finally {
    await server.destroy();
  }
}

export async function testDatabaseNames(db: Server): Promise<string[]> {
  const rows: Array<{ name: string }> = await withServer(db, (server) =>
    server.query(
      db === 'postgres'
        ? `SELECT datname AS name FROM pg_database WHERE datname LIKE 'nma!_t!_%' ESCAPE '!'`
        : `SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'nma!_t!_%' ESCAPE '!'`,
    ),
  );
  return rows.map((row) => row.name);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'; // exists, owned by someone else
  }
}

/** Drops databases of test processes that are gone (a killed run never reaches drop()). Returns their names. */
export async function sweepStaleDatabases(db: Server): Promise<string[]> {
  const stale = (await testDatabaseNames(db)).filter((name) => {
    const pid = Number(/^nma_t_(\d+)_/.exec(name)?.[1]);
    return !Number.isSafeInteger(pid) || !isAlive(pid);
  });
  await withServer(db, async (server) => {
    for (const name of stale) await server.query(dropSql(db, name));
  });
  return stale;
}

let swept: Promise<unknown> | undefined;

/** A new, empty database for one test app, so apps never see each other's rows. */
export async function testDatabase(entities: Function[]): Promise<TestDatabase> {
  if (TEST_DB === 'sqljs') return { options: { type: 'sqljs', entities, synchronize: true }, drop: async () => {} };
  const db = TEST_DB;
  swept ??= sweepStaleDatabases(db);
  await swept;
  const name = `nma_t_${process.pid}_${randomBytes(4).toString('hex')}`;
  await withServer(db, (server) => server.query(`CREATE DATABASE ${quote(db, name)}`));
  const url = new URL(SERVER_URLS[db]);
  url.pathname = `/${name}`;
  return {
    options: { type: db, url: url.toString(), entities, synchronize: true } as DataSourceOptions,
    url: url.toString(),
    drop: async () => {
      await withServer(db, (server) => server.query(dropSql(db, name)));
    },
  };
}
