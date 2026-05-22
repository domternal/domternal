#!/usr/bin/env node
/**
 * Dumps the public export surface of every built package to a tracked
 * snapshot file. Run from CI in --check mode to fail when the snapshot
 * differs from the committed file, surfacing every public-API change
 * (new export, rename, removal) in the PR diff.
 *
 *   node dump.mjs           write snapshots
 *   node dump.mjs --check   diff against committed snapshots, exit 1 if any drift
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const snapshotsDir = join(here, 'snapshots');
const check = process.argv.includes('--check');

mkdirSync(snapshotsDir, { recursive: true });

// Find packages with a built dist d.ts.
const packagesDir = join(repoRoot, 'packages');
const targets = readdirSync(packagesDir)
  .map((name) => ({ name, dts: join(packagesDir, name, 'dist', 'index.d.ts') }))
  .filter((t) => existsSync(t.dts));

// Parse every `export { ... }` block in a tsup dist d.ts. Each block is
// emitted on a single line, either `export { Names };` (local) or
// `export { Names } from '...';` (re-export). `[^}]*` keeps the match
// scoped to one block so adjacent `import { ... }` lines cannot bleed
// in. Each entry is `Name`, `type Name`, or `Source as Alias`. For the
// default export we record `default(Source)` so rebinding the default
// to a different underlying symbol shows up as drift.
function extractExports(content) {
  const exports = new Map();
  // Tsup emits two block shapes depending on version: inline `export {
  // type Foo, Bar }` or a separate `export type { Foo } / export { Bar }`
  // pair. Capture either; the optional `type` after `export` flags the
  // whole block as type-only.
  const blockPattern = /^export\s+(?:(type)\s+)?\{([^}]*)\}\s*(?:from\s*['"][^'"]+['"])?\s*;?$/gm;
  for (const m of content.matchAll(blockPattern)) {
    const blockIsType = m[1] === 'type';
    for (let raw of m[2].split(',')) {
      raw = raw.trim();
      if (!raw) continue;
      let isType = blockIsType;
      if (raw.startsWith('type ')) {
        isType = true;
        raw = raw.slice(5).trim();
      }
      const asMatch = raw.match(/^(\S+)\s+as\s+(\S+)$/);
      let name;
      if (asMatch) {
        name = asMatch[2] === 'default' ? `default(${asMatch[1]})` : asMatch[2];
      } else {
        name = raw;
      }
      exports.set(name, isType ? 'type' : 'value');
    }
  }
  return exports;
}

const drift = [];
for (const { name, dts } of targets) {
  const exports = extractExports(readFileSync(dts, 'utf8'));
  if (exports.size === 0) continue;

  const lines = [...exports.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([n, kind]) => `${kind} ${n}`);
  const out = lines.join('\n') + '\n';
  const snapshot = join(snapshotsDir, `${name}.txt`);

  if (check) {
    const existing = existsSync(snapshot) ? readFileSync(snapshot, 'utf8') : '';
    if (existing !== out) drift.push({ name, snapshot, existing, next: out });
  } else {
    writeFileSync(snapshot, out);
  }
}

if (check) {
  if (drift.length > 0) {
    console.error('[api-surface] FAILED: public API surface drifted from committed snapshots:');
    console.error('');
    for (const d of drift) {
      const rel = d.snapshot.slice(repoRoot.length + 1);
      console.error(`  ${rel}`);
      try {
        const diff = execFileSync('git', ['diff', '--no-index', '--no-color', '--', d.snapshot, '-'], {
          input: d.next,
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        console.error(String(diff).split('\n').slice(4).join('\n'));
      } catch (err) {
        if (err.stdout) console.error(String(err.stdout).split('\n').slice(4).join('\n'));
      }
    }
    console.error('[api-surface] run `node tests/api-surface/dump.mjs` and commit the updated snapshots if this is intentional.');
    process.exit(1);
  }
  console.log(`[api-surface] OK - ${targets.length} packages match committed snapshots`);
} else {
  console.log(`[api-surface] wrote ${targets.length} snapshots`);
}
