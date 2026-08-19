#!/usr/bin/env node
/**
 * Type-checks the built dists (not source) the way an external npm consumer
 * would, in both module systems.
 *
 * The ESM pass compiles `consumer.ts` and proves every RawCommands
 * augmentation reaches an `import` consumer. `coverage-check.mjs` keeps that
 * file exhaustive over commands.
 *
 * The CommonJS pass compiles `consumer-cjs.cts` and proves the `.d.cts` half
 * of every package resolves, which nothing else in this repository looks at.
 * `cjs-coverage-check.mjs` keeps that file exhaustive over packages.
 *
 * Both passes always run and both are reported, so a green ESM pass never
 * hides a broken CJS one.
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const coreDistDts = join(repoRoot, 'packages', 'core', 'dist', 'index.d.ts');
const log = (msg) => console.log(`[consumer-types] ${msg}`);

if (!existsSync(coreDistDts)) {
  log('packages/core/dist missing, building first');
  execSync('pnpm --filter @domternal/core build', { cwd: repoRoot, stdio: 'inherit' });
}

const tscBin = join(here, 'node_modules', '.bin', 'tsc');
if (!existsSync(tscBin)) {
  console.error('[consumer-types] tsc not installed, run pnpm install at repo root first');
  process.exit(1);
}

// The unit tests for both coverage readers and the comment stripper they share.
// Other gates run theirs from the root script next to the gate itself; these are
// reached through a package script, so their entry point is here. They run
// before the checks: a reader that has stopped behaving as specified is how
// both coverage numbers below became believable and wrong.
log('coverage unit tests');
const units = spawnSync(
  'node',
  [
    '--test',
    join(here, 'strip-comments.test.mjs'),
    join(here, 'coverage-check.test.mjs'),
    join(here, 'cjs-coverage-check.test.mjs'),
  ],
  { cwd: here, stdio: 'inherit' }
);
if (units.status !== 0) {
  console.error('[consumer-types] FAILED: a coverage reader no longer behaves as specified');
  process.exit(units.status ?? 1);
}

log('coverage check');
const cov = spawnSync('node', [join(here, 'coverage-check.mjs')], { cwd: here, stdio: 'inherit' });
if (cov.status !== 0) process.exit(cov.status ?? 1);

log('cjs coverage check');
const covCjs = spawnSync('node', [join(here, 'cjs-coverage-check.mjs')], {
  cwd: here,
  stdio: 'inherit',
});
if (covCjs.status !== 0) process.exit(covCjs.status ?? 1);

log('tsc against built dists (ESM)');
// `tsconfig.check.json` (not `tsconfig.json`): @nx/js typescript-sync
// auto-rewrites `tsconfig.json` to add project references back to
// workspace dependency sources, which would shortcut node resolution
// and make tsc read source instead of the built dist.
const tsc = spawnSync(tscBin, ['--noEmit', '--project', 'tsconfig.check.json'], {
  cwd: here,
  stdio: 'inherit',
});

if (tsc.status !== 0) {
  console.error('[consumer-types] FAILED: a RawCommands augmentation is missing from the dist');
  console.error('[consumer-types] the ESM pass reads dist/index.d.ts through the `import`');
  console.error('[consumer-types] condition of each exports map, the way `import` consumers do.');
  process.exit(tsc.status ?? 1);
}
log('ESM pass OK');

log('tsc against built dists (CommonJS)');
// Its own config so the CJS consumer keeps `skipLibCheck: false` on a
// declaration graph the ESM config never loads. See tsconfig.check-cjs.json
// for why that flag is the whole point of this pass.
const tscCjs = spawnSync(tscBin, ['--noEmit', '--project', 'tsconfig.check-cjs.json'], {
  cwd: here,
  stdio: 'inherit',
});

if (tscCjs.status !== 0) {
  console.error('[consumer-types] FAILED: the CommonJS declaration graph does not type-check');
  console.error('[consumer-types] the CJS pass reads dist/index.d.cts through the `require`');
  console.error('[consumer-types] condition of each exports map. The usual causes are a `types`');
  console.error('[consumer-types] condition lost from an exports map, a re-export that only');
  console.error('[consumer-types] resolves under `import`, or a tsup dts build that emitted the');
  console.error('[consumer-types] .d.ts but not the matching .d.cts. Reproduce it with:');
  console.error('[consumer-types]   pnpm --filter @domternal/tests-consumer-types exec \\');
  console.error('[consumer-types]     tsc --noEmit --project tsconfig.check-cjs.json --explainFiles');
  process.exit(tscCjs.status ?? 1);
}
log('CommonJS pass OK');

log('OK');
