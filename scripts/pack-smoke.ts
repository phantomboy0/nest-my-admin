import { $ } from 'bun';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { OLDEST_SUPPORTED } from './oldest-supported.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`pack-smoke: ${message}`);
}

async function waitFor(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // server not up yet
    }
    await Bun.sleep(250);
  }
  throw new Error(`pack-smoke: timed out waiting for ${url}`);
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

const root = resolve(import.meta.dir, '..');
const work = mkdtempSync(join(tmpdir(), 'nma-pack-'));
const tarballs = join(work, 'tarballs');
console.log(`pack-smoke: working in ${work}`);

await $`bun run build`.cwd(root);
await $`bun pm pack --destination ${tarballs} --quiet`.cwd(join(root, 'packages/ui'));
await $`bun pm pack --destination ${tarballs} --quiet`.cwd(join(root, 'packages/core'));
const files = readdirSync(tarballs);
function tarball(prefix: string): string {
  const file = files.find((name) => name.startsWith(prefix));
  assert(file, `no ${prefix}*.tgz in ${tarballs}`);
  return join(tarballs, file);
}
const uiTgz = tarball('nest-my-admin-ui-');
const coreTgz = tarball('nest-my-admin-core-');

// 1. The packed core depends on an exact ui version, never on a workspace: range.
const corePackage = await $`tar -xzOf ${coreTgz} package/package.json`.text();
assert(!corePackage.includes('workspace:'), 'core tarball still contains a workspace: range');
assert(/"@nest-my-admin\/ui":\s*"\d+\.\d+\.\d+/.test(corePackage), 'core tarball does not pin @nest-my-admin/ui');

// 2. The ui tarball ships only the build (no React, no sources).
const uiEntries = (await $`tar -tzf ${uiTgz}`.text()).trim().split('\n');
assert(uiEntries.includes('package/dist/index.html'), 'ui tarball has no dist/index.html');
const unexpected = uiEntries.filter(
  (entry) => !entry.endsWith('/') && entry !== 'package/package.json' && !entry.startsWith('package/dist/') && !/^package\/(README|LICENSE)/i.test(entry),
);
assert(unexpected.length === 0, `unexpected files in ui tarball: ${unexpected.join(', ')}`);

// 3. Fresh consumer projects install the tarballs with npm, compile with tsc and boot on Node and Bun:
//    an ESM host on the stack we develop against, and a CommonJS host on the oldest supported stack.
const coreDev = JSON.parse(readFileSync(join(root, 'packages/core/package.json'), 'utf8')).devDependencies as Record<string, string>;
const rootDev = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies as Record<string, string>;
const pick = (names: string[], from: Record<string, string>) => Object.fromEntries(names.map((name) => [name, from[name]!]));
const runtimeDeps = ['sql.js', 'reflect-metadata', 'rxjs', 'class-validator', 'class-transformer'];
const hostDeps = ['@nestjs/common', '@nestjs/core', '@nestjs/platform-express', '@nestjs/typeorm', 'typeorm'];

const consumers = [
  {
    name: 'esm',
    type: 'module' as const,
    dependencies: pick([...hostDeps, ...runtimeDeps], coreDev),
    devDependencies: pick(['typescript', '@types/node'], rootDev),
  },
  {
    name: 'cjs',
    type: undefined, // no "type": CommonJS
    dependencies: { ...pick(hostDeps, OLDEST_SUPPORTED), ...pick(runtimeDeps, coreDev) },
    devDependencies: { typescript: '5.9.3', '@types/node': '22.10.0' },
  },
];

for (const consumer of consumers) {
  const app = join(work, `consumer-${consumer.name}`);
  cpSync(join(root, 'scripts/pack-fixtures', consumer.name), app, { recursive: true });
  writeFileSync(
    join(app, 'package.json'),
    JSON.stringify(
      {
        name: `nma-consumer-${consumer.name}`,
        private: true,
        ...(consumer.type ? { type: consumer.type } : {}),
        dependencies: { '@nest-my-admin/ui': `file:${uiTgz}`, '@nest-my-admin/core': `file:${coreTgz}`, ...consumer.dependencies },
        devDependencies: consumer.devDependencies,
        overrides: { '@nest-my-admin/ui': '$@nest-my-admin/ui' },
      },
      null,
      2,
    ),
  );
  await $`npm install --no-audit --no-fund`.cwd(app);
  await $`npx tsc -p tsconfig.json`.cwd(app);

  for (const runtime of ['node', 'bun'] as const) {
    const label = `${consumer.name}/${runtime}`;
    const port = await freePort();
    const server = Bun.spawn([runtime, 'dist/main.js'], { cwd: app, env: { ...process.env, PORT: String(port) }, stdout: 'inherit', stderr: 'inherit' });
    try {
      const origin = `http://localhost:${port}`;
      await waitFor(`${origin}/admin/api/meta`);

      const html = await (await fetch(`${origin}/admin/note/42`)).text();
      assert(html.includes('<base href="/admin/">') && html.includes('id="nma-config"'), `${label}: index.html missing runtime injection`);
      const asset = /src="\.\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
      assert(asset, `${label}: index.html references no JS asset`);
      const js = await fetch(`${origin}/admin/${asset}`);
      assert(js.status === 200 && (js.headers.get('content-type') ?? '').includes('javascript'), `${label}: asset not served`);

      const meta = (await (await fetch(`${origin}/admin/api/meta`)).json()) as { groups: { resources: { name: string }[] }[] };
      assert(meta.groups[0]?.resources[0]?.name === 'note', `${label}: meta does not list the note resource`);
      const created = await fetch(`${origin}/admin/api/resources/note`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'hello' }),
      });
      assert(created.status === 201, `${label}: create returned ${created.status}`);
      const found = (await (await fetch(`${origin}/admin/api/resources/note?search=hel`)).json()) as { total: number };
      assert(found.total === 1, `${label}: search found ${found.total} notes`);
      console.log(`pack-smoke: ✓ ${label}`);
    } finally {
      server.kill();
      await server.exited;
    }
  }
}

rmSync(work, { recursive: true, force: true });
console.log('pack-smoke: all checks passed');
