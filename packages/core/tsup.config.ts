import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'es2022',
  dts: {
    resolve: true,
    compilerOptions: {
      composite: false,
    },
  },
  sourcemap: true,
  splitting: false,
  treeshake: true,
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
