import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { localeEntries } from '../../scripts/locale-build.mjs';
import { defineConfig } from 'tsup';
import type { Options } from 'tsup';

type EsbuildPlugin = NonNullable<Options['esbuildPlugins']>[number];

/**
 * Emits each listed entry as named re-exports of the sibling main bundle instead of a
 * second copy of its modules. With `splitting: false` a plain entry would bundle the
 * clipboard registries again, so a registration made through the subpath would never
 * reach the Editor. The plugin lives in this file on purpose: the Nx project inputs and
 * the locale build receipt both hash it, so a change rebuilds dist.
 */
function reexportMainBundle(subpaths: readonly string[]): EsbuildPlugin {
  const entries = new Set(subpaths.map((path) => resolve(path)));
  const namespace = 'domternal-main-bundle-reexport';
  return {
    name: namespace,
    setup(build) {
      // With treeshake on, tsup runs esbuild as ESM for both formats and converts to
      // CommonJS afterwards, so only its TSUP_FORMAT define names the real format.
      const format: unknown = JSON.parse(build.initialOptions.define?.['TSUP_FORMAT'] ?? 'null');
      if (format !== 'esm' && format !== 'cjs') throw new Error(`Unexpected tsup format: ${String(format)}`);
      const main = format === 'cjs' ? './index.cjs' : './index.js';
      // Only the entry point load moves into the private namespace. The main bundle
      // still imports the same file normally, so one list serves both.
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind !== 'entry-point') return undefined;
        const path = resolve(args.resolveDir, args.path);
        return entries.has(path) ? { path, namespace } : undefined;
      });
      build.onLoad({ filter: /.*/, namespace }, async (args) => ({
        contents: await readFile(args.path, 'utf8'),
        loader: 'ts',
        resolveDir: dirname(args.path),
      }));
      build.onResolve({ filter: /.*/, namespace }, (args) => args.path.startsWith('.')
        ? { path: main, external: true }
        : { errors: [{ text: `${args.path}: a main bundle re-export entry may only re-export relative modules` }] });
    },
  };
}

// Called once: it regenerates the locale sources.
const locales = localeEntries('@domternal/core');

export default defineConfig({
  // dist/index.* runs index.bundle.ts, which adds the clipboard bindings that
  // dist/clipboard.* re-exports. The declarations come from index.ts, so the main
  // entry does not declare them.
  entry: { index: 'src/index.bundle.ts', clipboard: 'src/clipboard.ts', ...locales },
  format: ['esm', 'cjs'],
  target: 'es2022',
  dts: {
    entry: { index: 'src/index.ts', clipboard: 'src/clipboard.ts', ...locales },
    resolve: true,
    compilerOptions: {
      composite: false,
    },
  },
  sourcemap: true,
  splitting: false,
  treeshake: true,
  esbuildPlugins: [reexportMainBundle(['src/clipboard.ts'])],
  external: [
    '@domternal/pm/commands',
    '@domternal/pm/dropcursor',
    '@domternal/pm/gapcursor',
    '@domternal/pm/history',
    '@domternal/pm/inputrules',
    '@domternal/pm/keymap',
    '@domternal/pm/model',
    '@domternal/pm/schema-list',
    '@domternal/pm/state',
    '@domternal/pm/tables',
    '@domternal/pm/transform',
    '@domternal/pm/view',
  ],
});
