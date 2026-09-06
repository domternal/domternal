import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import shared from '../fixtures/vite.config.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const workspace = fileURLToPath(new URL('../..', import.meta.url));

export default {
  ...shared,
  root,
  cacheDir: join(workspace, 'node_modules/.vite/link-security-fixture'),
  server: { ...shared.server, port: 5896 },
};
