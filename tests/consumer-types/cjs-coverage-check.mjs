#!/usr/bin/env node
/**
 * Fails when a package ships a CommonJS entry that `consumer-cjs.cts` never
 * imports, so the CJS pass cannot quietly shrink to the packages it happened
 * to cover on the day it was written.
 *
 * `coverage-check.mjs` next door does the same job one level down: it keeps
 * `consumer.ts` exhaustive over commands. This one keeps `consumer-cjs.cts`
 * exhaustive over packages. The two are deliberately separate because they
 * prove different things and read different files.
 *
 * ## Why the CJS fixture does not feed the command coverage check
 *
 * `coverage-check.mjs` reads `consumer.ts` and nothing else, and that is on
 * purpose. If the union of both fixtures satisfied it, a command exercised
 * only in the CJS fixture would count as covered and the ESM pass, the one
 * that runs with the whole command surface in front of it, would stop proving
 * anything about that command. Feeding it only the CJS fixture instead would
 * mean maintaining the same 130-odd calls twice. So command exhaustiveness
 * stays with the ESM consumer, and the CJS consumer carries one call per
 * augmenting package: enough to prove each `declare module '@domternal/core'`
 * block reaches the `.d.cts` graph, which is the failure this pass is for.
 *
 * ## What counts as shipping a CommonJS entry
 *
 * The root (`.`) export having a `require` condition, read from
 * `publishConfig.exports` when there is one, since that is what is actually
 * published. Packages without it are ESM-only by design: today `@domternal/
 * react`, `@domternal/vue` and `@domternal/vanilla`, which CI checks with
 * `attw --profile esm-only`, plus `@domternal/theme`, which ships no JS.
 * Nothing is hardcoded here, so the day one of them gains a `require`
 * condition this check asks for it without anyone remembering to.
 *
 * ## Why subpath exports are out of scope
 *
 * `@domternal/pm` is the only package that publishes subpaths and no root
 * entry, and its `.d.cts` files arrive in this pass anyway: core and
 * extension-table import them from their own `.d.cts` files, and with
 * `skipLibCheck` off tsc checks everything it loads. Listing the subpaths
 * would add names to the fixture that the compiler already reads.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './strip-comments.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/** The `types` target of an exports condition, following `default` inward. */
export function typesTarget(entry) {
  if (entry === null || typeof entry !== 'object') return null;
  if (typeof entry.types === 'string') return entry.types;
  if ('default' in entry) return typesTarget(entry.default);
  return null;
}

/**
 * What a package's root export promises a `require()` caller, or null when it
 * promises nothing because the package is ESM-only.
 *
 * `publishConfig.exports` wins where it exists: that is the map npm publishes,
 * and the development-time one carries source conditions a consumer never sees.
 */
export function rootRequireEntry(manifest) {
  const exportsMap = manifest.publishConfig?.exports ?? manifest.exports;
  if (exportsMap === null || typeof exportsMap !== 'object') return null;
  const root = exportsMap['.'];
  if (root === null || typeof root !== 'object') return null;
  if (!('require' in root)) return null;
  return { specifier: manifest.name, types: typesTarget(root.require) };
}

/**
 * The specifiers `consumer-cjs.cts` imports.
 *
 * Only the `import x = require('...')` form is read, because that is the only
 * form that compiles in a `.cts` file under `verbatimModuleSyntax`, and an
 * `import type` would resolve the ESM graph instead of the one under test.
 *
 * Comments come out first, and the binding name is part of the pattern rather
 * than a bare `require(` match. Both guard the same failure, which an
 * adversarial review demonstrated: commenting out the `extension-toc` line and
 * deleting its two uses left this gate reporting 12 of 12 entries imported
 * while that package's `.d.cts` was never handed to tsc. A count that survives
 * the removal of the thing it counts is worse than no count, so what is matched
 * now is what actually compiles.
 */
export function collectRequiredSpecifiers(source) {
  const found = new Set();
  const pattern = /\bimport\s+[A-Za-z_$][\w$]*\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of stripComments(source).matchAll(pattern)) found.add(match[1]);
  return found;
}

/**
 * Every violation, given what ships CJS, what this package may resolve, and
 * what the fixture actually imports.
 *
 * `unreachable` is reported rather than failed: importing such a package needs
 * a line in `tests/consumer-types/package.json`, which is not this file's to
 * write, so the check names it and says what to add.
 */
export function audit({ shipping, dependencies, required }) {
  const missing = [];
  const unreachable = [];
  for (const { specifier } of shipping) {
    if (!dependencies.has(specifier)) {
      unreachable.push(specifier);
      continue;
    }
    if (!required.has(specifier)) missing.push(specifier);
  }
  const shippingNames = new Set(shipping.map((entry) => entry.specifier));
  const stale = [...required].filter((specifier) => !shippingNames.has(specifier));
  return { missing: missing.sort(), unreachable: unreachable.sort(), stale: stale.sort() };
}

function main() {
  const packagesDir = join(repoRoot, 'packages');
  const shipping = [];
  for (const name of readdirSync(packagesDir).sort()) {
    const manifestPath = join(packagesDir, name, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const entry = rootRequireEntry(manifest);
    if (entry === null) continue;
    /* Loud, like coverage-check.mjs: a declaration target that is not there
       yet would silently narrow what the CJS pass reads. */
    if (entry.types !== null) {
      const dts = resolve(packagesDir, name, entry.types);
      if (!existsSync(dts)) {
        console.error(
          `[cjs-coverage] FAILED: ${manifest.name} declares ${entry.types} for require, ` +
            `but ${relative(repoRoot, dts)} is missing; build the packages first`
        );
        process.exit(1);
      }
    }
    shipping.push(entry);
  }

  const own = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
  const dependencies = new Set(Object.keys(own.dependencies ?? {}));
  const required = collectRequiredSpecifiers(
    readFileSync(join(here, 'consumer-cjs.cts'), 'utf8')
  );

  const { missing, unreachable, stale } = audit({ shipping, dependencies, required });

  if (missing.length > 0) {
    console.error('[cjs-coverage] FAILED: packages ship a CommonJS entry that nothing type-checks:');
    console.error('');
    for (const specifier of missing) console.error(`  - ${specifier}`);
    console.error('');
    console.error('[cjs-coverage] add `import name = require(\'PACKAGE\');` to');
    console.error('[cjs-coverage] tests/consumer-types/consumer-cjs.cts, and name one export from');
    console.error('[cjs-coverage] it, so its .d.cts graph is checked the way an npm consumer');
    console.error('[cjs-coverage] compiling CommonJS would check it.');
    process.exit(1);
  }

  if (unreachable.length > 0) {
    console.error('[cjs-coverage] WARN: these ship a CommonJS entry but cannot be imported here:');
    for (const specifier of unreachable) console.error(`  - ${specifier}`);
    console.error('[cjs-coverage] add each as `"PACKAGE": "workspace:*"` under dependencies in');
    console.error('[cjs-coverage] tests/consumer-types/package.json, then import it in');
    console.error('[cjs-coverage] consumer-cjs.cts. Until then their .d.cts files are unchecked.');
  }

  if (stale.length > 0) {
    console.error('[cjs-coverage] WARN: consumer-cjs.cts requires specifiers no package ships:');
    for (const specifier of stale) console.error(`  - ${specifier}`);
  }

  console.log(
    `[cjs-coverage] OK - ${shipping.length - unreachable.length} of ${shipping.length} ` +
      'CommonJS entries imported by consumer-cjs.cts'
  );
}

// Importable for the unit tests, executable as the check.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
