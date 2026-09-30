/**
 * Runs the core and auth typechecks and test suites on the oldest supported NestJS/TypeORM (scripts/oldest-supported.ts).
 * Works on a copy of the working tree (committed or not) in a temp directory; the repository is never modified.
 * Honours NMA_TEST_DB. KEEP_COMPAT_DIR=1 keeps the copy for debugging.
 */
import { $ } from 'bun';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { OLDEST_SUPPORTED } from './oldest-supported.ts';

const root = resolve(import.meta.dir, '..');
const work = mkdtempSync(join(tmpdir(), 'nma-compat-'));
console.log(`compat: ${Object.entries(OLDEST_SUPPORTED).map(([name, version]) => `${name}@${version}`).join(' ')}`);
console.log(`compat: working in ${work}`);

try {
  const files = (await $`git ls-files -z --cached --others --exclude-standard`.cwd(root).text()).split('\0').filter(Boolean);
  for (const file of files) {
    if (!existsSync(join(root, file))) continue; // deleted in the working tree
    mkdirSync(dirname(join(work, file)), { recursive: true });
    copyFileSync(join(root, file), join(work, file));
  }

  for (const pkg of ['core', 'auth']) {
    const manifestPath = join(work, `packages/${pkg}/package.json`);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { devDependencies: Record<string, string> };
    for (const [name, version] of Object.entries(OLDEST_SUPPORTED)) {
      if (!(name in manifest.devDependencies)) throw new Error(`compat: ${name} is not a devDependency of ${pkg}`);
      manifest.devDependencies[name] = version;
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }

  await $`bun install`.cwd(work);
  const core = join(work, 'packages/core');
  const typeorm = (await $`bun -e "console.log(require('typeorm/package.json').version)"`.cwd(core).text()).trim();
  if (typeorm !== OLDEST_SUPPORTED.typeorm) throw new Error(`compat: core resolved typeorm ${typeorm}, expected ${OLDEST_SUPPORTED.typeorm}`);
  await $`bun run typecheck`.cwd(core);
  await $`bun test`.cwd(core);
  // The auth package runs against core's build.
  const auth = join(work, 'packages/auth');
  await $`bun run build`.cwd(core);
  await $`bun run typecheck`.cwd(auth);
  await $`bun test`.cwd(auth);
  console.log('compat: all checks passed');
} finally {
  if (process.env.KEEP_COMPAT_DIR) console.log(`compat: kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}
