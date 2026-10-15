import { fileURLToPath } from 'node:url';
import base from '../fixtures/vite.config.mjs';
export default {
  ...base,
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/list-label-fixture', import.meta.url)),
  optimizeDeps: { ...base.optimizeDeps, entries: ['index.html'] },
  server: { ...base.server, port: 5896 },
};
