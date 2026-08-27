import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/html/index.ts'],
  format: ['esm', 'cjs'],
  target: 'es2022',
  dts: { compilerOptions: { composite: false } },
  sourcemap: true,
  splitting: false,
  treeshake: true,
  noExternal: ['hast-util-from-parse5', 'hast-util-sanitize', 'hast-util-to-html'],
  external: ['@domternal/core', '@domternal/pm', '@domternal/pm/state', '@domternal/pm/model', '@domternal/pm/view'],
});
