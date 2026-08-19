import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/types/**', 'src/**/index.ts'],
      // Floors, not targets: each sits a few points under what this package
      // measured when they were set, so ordinary movement passes and a real
      // regression does not. Raise them as tests land.
      thresholds: { statements: 90, branches: 83, functions: 91, lines: 93 },
    },
  },
});
