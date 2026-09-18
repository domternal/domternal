import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import shared from '../fixtures/vite.config.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const workspace = fileURLToPath(new URL('../..', import.meta.url));
const angularRequire = createRequire(join(workspace, 'apps/demo-angular/package.json'));
const angular = ['@angular/core/primitives/signals', '@angular/core/primitives/di', '@angular/common/http',
  '@angular/core', '@angular/compiler', '@angular/common', '@angular/forms', '@angular/platform-browser'];
const aliases = angular.map(find => ({ find, replacement: angularRequire.resolve(find) }));
aliases.push({ find: 'rxjs', replacement: dirname(angularRequire.resolve('rxjs/package.json')) });

export default {
  ...shared,
  root,
  cacheDir: join(workspace, 'node_modules/.vite/i18n-ownership-fixture'),
  resolve: {
    ...shared.resolve,
    alias: [...aliases, ...shared.resolve.alias],
    dedupe: [...shared.resolve.dedupe, ...angular, 'rxjs'],
  },
  optimizeDeps: { ...shared.optimizeDeps, include: [...shared.optimizeDeps.include, ...angular, 'rxjs'] },
  server: { ...shared.server, port: 5894 },
};
