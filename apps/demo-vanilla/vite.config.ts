import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    conditions: ['@domternal/source'],
  },
  server: {
    port: 5175,
  },
  preview: {
    port: 5175,
  },
});
