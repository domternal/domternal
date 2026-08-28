import { localeEntries } from '../../scripts/locale-build.mjs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'html/index': 'src/html/index.ts',
    ...localeEntries('@domternal/extension-paste-cleanup'),
  },
  format: ['esm', 'cjs'],
  target: 'es2022',
  dts: {
    compilerOptions: {
      composite: false,
      paths: { '@domternal/extension-paste-cleanup': ['./src/index.ts'] },
    },
  },
  sourcemap: true,
  splitting: false,
  treeshake: true,
  noExternal: ['hast-util-from-parse5', 'hast-util-sanitize', 'hast-util-to-html'],
  external: ['@domternal/extension-paste-cleanup', '@domternal/core', '@domternal/pm', '@domternal/pm/state', '@domternal/pm/model', '@domternal/pm/view', '@domternal/pm/transform'],
});
