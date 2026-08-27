import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['paste-cleanup.browser.ts'],
  forbidOnly: true,
  retries: 0,
  timeout: 30000,
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  projects: ['chromium', 'firefox', 'webkit'].map(browserName => ({
    name: browserName,
    use: { browserName: browserName as 'chromium' | 'firefox' | 'webkit' },
  })),
  webServer: {
    command: 'node apps/demo-react/node_modules/vite/bin/vite.js --config e2e/paste-cleanup-fixture/vite.config.mjs',
    url: 'http://127.0.0.1:5895',
    reuseExistingServer: false,
    timeout: 120000,
    cwd: '..',
  },
});
