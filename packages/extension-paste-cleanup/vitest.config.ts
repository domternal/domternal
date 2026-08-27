import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@domternal/source'] },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/html/index.ts'],
      // Keep a small margin below the measured baseline to catch coverage regressions.
      thresholds: { statements: 90, branches: 85, functions: 92, lines: 95 },
    },
  },
});
