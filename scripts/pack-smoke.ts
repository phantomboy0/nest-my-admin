import { $ } from 'bun';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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

const root = resolve(import.meta.dir, '..');
const work = mkdtempSync(join(tmpdir(), 'nma-pack-'));
const tarballs = join(work, 'tarballs');
console.log(`pack-smoke: working in ${work}`);

await $`bun run build`.cwd(root);
await $`bun pm pack --destination ${tarballs} --quiet`.cwd(join(root, 'packages/ui'));
await $`bun pm pack --destination ${tarballs} --quiet`.cwd(join(root, 'packages/core'));
const files = readdirSync(tarballs);
const uiTgz = join(tarballs, files.find((f) => f.startsWith('nest-my-admin-ui-'))!);
const coreTgz = join(tarballs, files.find((f) => f.startsWith('nest-my-admin-core-'))!);

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

// 3. A fresh consumer project installs the tarballs with npm and compiles with tsc.
const app = join(work, 'consumer');
cpSync(join(root, 'scripts/pack-fixture'), app, { recursive: true });
const coreDev = JSON.parse(readFileSync(join(root, 'packages/core/package.json'), 'utf8')).devDependencies as Record<string, string>;
const rootDev = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies as Record<string, string>;
const pick = (names: string[], from: Record<string, string>) => Object.fromEntries(names.map((name) => [name, from[name]!]));
writeFileSync(
  join(app, 'package.json'),
  JSON.stringify(
    {
      name: 'nma-consumer',
      private: true,
      type: 'module',
      dependencies: {
        '@nest-my-admin/ui': `file:${uiTgz}`,
        '@nest-my-admin/core': `file:${coreTgz}`,
        ...pick(
          ['@nestjs/common', '@nestjs/core', '@nestjs/platform-express', '@nestjs/typeorm', 'typeorm', 'sql.js', 'reflect-metadata', 'rxjs', 'class-validator', 'class-transformer'],
          coreDev,
        ),
      },
      devDependencies: pick(['typescript', '@types/node'], rootDev),
      overrides: { '@nest-my-admin/ui': '$@nest-my-admin/ui' },
    },
    null,
    2,
  ),
);
await $`npm install --no-audit --no-fund`.cwd(app);
await $`npx tsc -p tsconfig.json`.cwd(app);

// 4. Boot on each runtime and exercise UI + API.
for (const [runtime, port] of [['node', 4311], ['bun', 4312]] as const) {
  const server = Bun.spawn([runtime, 'dist/main.js'], { cwd: app, env: { ...process.env, PORT: String(port) }, stdout: 'inherit', stderr: 'inherit' });
  try {
    const origin = `http://localhost:${port}`;
    await waitFor(`${origin}/admin/api/meta`);

    const html = await (await fetch(`${origin}/admin/note/42`)).text();
    assert(html.includes('<base href="/admin/">') && html.includes('id="nma-config"'), `${runtime}: index.html missing runtime injection`);
    const asset = /src="\.\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
    assert(asset, `${runtime}: index.html references no JS asset`);
    const js = await fetch(`${origin}/admin/${asset}`);
    assert(js.status === 200 && (js.headers.get('content-type') ?? '').includes('javascript'), `${runtime}: asset not served`);

    const meta = (await (await fetch(`${origin}/admin/api/meta`)).json()) as { groups: { resources: { name: string }[] }[] };
    assert(meta.groups[0]?.resources[0]?.name === 'note', `${runtime}: meta does not list the note resource`);
    const created = await fetch(`${origin}/admin/api/resources/note`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'hello' }),
    });
    assert(created.status === 201, `${runtime}: create returned ${created.status}`);
    console.log(`pack-smoke: ✓ ${runtime}`);
  } finally {
    server.kill();
    await server.exited;
  }
}

rmSync(work, { recursive: true, force: true });
console.log('pack-smoke: all checks passed');
