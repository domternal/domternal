import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    conditions: ['@domternal/source'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      // Floors, not targets: a few points under the measured value, so a real
      // regression fails and ordinary movement does not. Branches is the
      // thinnest here of any package, and is the one worth raising first.
      thresholds: { statements: 86, branches: 72, functions: 92, lines: 92 },
    },
  },
});
