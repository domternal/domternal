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
      exclude: ['src/**/*.test.ts'],
      // This deprecated compatibility package is a one-line re-export shim.
      // Anything below complete coverage means the forwarding contract was no
      // longer exercised at all.
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
