import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@domternal/source'] },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
