import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'browser.test.mjs', forbidOnly: true, retries: 0,
  timeout: 30_000, workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5896', trace: 'retain-on-failure' },
  projects: ['chromium', 'firefox', 'webkit'].map(browserName => ({ name: browserName, use: { browserName } })),
  webServer: {
    command: 'node server.mjs', cwd: import.meta.dirname,
    url: 'http://127.0.0.1:5896', reuseExistingServer: false, timeout: 30_000,
  },
});
