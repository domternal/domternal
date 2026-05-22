#!/usr/bin/env node
/**
 * Type-checks consumer.ts against the BUILT @domternal/core dist (not
 * source) to verify every RawCommands augmentation reaches an external
 * npm consumer. Pairs with coverage-check.mjs which keeps consumer.ts
 * exhaustive.
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

log('coverage check');
const cov = spawnSync('node', [join(here, 'coverage-check.mjs')], { cwd: here, stdio: 'inherit' });
if (cov.status !== 0) process.exit(cov.status ?? 1);

log('tsc against built @domternal/core');
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
  process.exit(tsc.status ?? 1);
}

log('OK');
