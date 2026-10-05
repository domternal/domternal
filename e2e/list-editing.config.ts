/** Existing list-editing regressions against every built framework and browser. */
import { defineConfig } from '@playwright/test';
import matrix from './playwright.config.js';
import { demoTargets } from './targets.js';

const servers = Array.isArray(matrix.webServer) ? matrix.webServer : [];
export default defineConfig({
  forbidOnly: true,
  retries: 0,
  timeout: 30000,
  workers: 2,
  reporter: 'list',
  testMatch: ['nested-lists.spec.ts', 'list-audit-fixes.spec.ts', 'notion-list-cursor-context.spec.ts', 'list-join-on-insert.spec.ts', 'notion-list-strict.spec.ts'],
  use: { trace: 'retain-on-failure' },
  projects: ['chromium', 'firefox', 'webkit'].flatMap(browserName => demoTargets.map(target => ({
    name: `${target.name}-${browserName}`,
    testDir: `../apps/demo-${target.name}/e2e`,
    use: { browserName: browserName as 'chromium' | 'firefox' | 'webkit', baseURL: target.baseURL },
  }))),
  webServer: servers.filter(server => server.url !== 'http://127.0.0.1:5793/tutorial-lifecycle/')
    .map(server => ({ ...server, reuseExistingServer: false })),
});
