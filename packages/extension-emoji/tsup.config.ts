import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'es2022',
  dts: {
    compilerOptions: {
      composite: false,
    },
  },
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: [
    '@domternal/core',
    'prosemirror-model',
    'prosemirror-state',
    'prosemirror-view',
    'prosemirror-transform',
    'prosemirror-commands',
    'prosemirror-keymap',
    'prosemirror-inputrules',
    'prosemirror-history',
    'prosemirror-schema-list',
    'prosemirror-dropcursor',
    'prosemirror-gapcursor',
  ],
});
