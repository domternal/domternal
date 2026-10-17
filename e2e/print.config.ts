import { defineConfig } from '@playwright/test';
import { tutorialFixtureServer } from './tutorial-fixture-server.js';

export default defineConfig({
  testDir: '.',
  testMatch: 'print-lifecycle.spec.ts',
  timeout: 30000,
  fullyParallel: true,
  workers: 3,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  projects: ['chromium', 'firefox', 'webkit'].map(browserName => ({ name: browserName, use: { browserName: browserName as 'chromium' | 'firefox' | 'webkit' } })),
  webServer: tutorialFixtureServer,
});
