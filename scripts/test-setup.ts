import { plugin } from 'bun';
import { setDefaultTimeout } from 'bun:test';

/**
 * Integration tests boot a Nest app on a fresh database each; on a loaded machine that takes longer than Bun's
 * default of 5 s, and whole suites then fail on timeouts that have nothing to do with the code.
 *
 * Bun 1.4.2 reads no timeout from bunfig.toml, and a `setDefaultTimeout()` made in a preload holds for the first test
 * file of a run only (the default is reset for every file after it; hooks follow the same default). So every test
 * file gets the call prepended as it is loaded; on the same line, so the line numbers in traces stay true.
 *
 * Preloaded by the `bunfig.toml` of the root and of each workspace that has tests (Bun reads the one in the directory
 * it is started from). Playwright files (`*.pw.ts`) are not Bun tests and are not touched.
 */
export const DEFAULT_TIMEOUT_MS = 20_000;
setDefaultTimeout(DEFAULT_TIMEOUT_MS);
plugin({
  name: 'default-timeout',
  setup(build) {
    build.onLoad({ filter: /\.test\.tsx?$/ }, async ({ path }) => ({
      contents: `import { setDefaultTimeout as __setDefaultTimeout } from 'bun:test'; __setDefaultTimeout(${DEFAULT_TIMEOUT_MS}); ${await Bun.file(path).text()}`,
      loader: path.endsWith('x') ? 'tsx' : 'ts',
    }));
  },
});
