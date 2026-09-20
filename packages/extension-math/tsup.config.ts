import { localeEntries } from '../../scripts/locale-build.mjs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', ...localeEntries('@domternal/extension-math') },
  format: ['esm', 'cjs'],
  target: 'es2022',
  dts: {
    compilerOptions: {
      composite: false,
      paths: { '@domternal/extension-math': ['./src/index.ts'] },
    },
  },
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: [
    '@domternal/extension-math',
    '@domternal/core',
    'katex',
    '@domternal/pm/model',
    '@domternal/pm/state',
    '@domternal/pm/view',
    '@domternal/pm/transform',
    '@domternal/pm/commands',
    '@domternal/pm/keymap',
    '@domternal/pm/inputrules',
    '@domternal/pm/history',
    '@domternal/pm/schema-list',
    '@domternal/pm/dropcursor',
    '@domternal/pm/gapcursor',
  ],
});
