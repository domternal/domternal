/**
 * Link and URL security in real browsers: the URL policy against what each
 * browser reads, and the link sinks (render, click, popover) of the public
 * core build. The fixture page configures its extensions per test.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['link-security.browser.ts'],
  forbidOnly: true,
  retries: 0,
  timeout: 30000,
  workers: 2,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  projects: ['chromium', 'firefox', 'webkit'].map(browserName => ({
    name: browserName,
    use: { browserName: browserName as 'chromium' | 'firefox' | 'webkit' },
  })),
  webServer: {
    command: 'node apps/demo-react/node_modules/vite/bin/vite.js --config e2e/link-security-fixture/vite.config.mjs',
    url: 'http://127.0.0.1:5896',
    reuseExistingServer: false,
    timeout: 120000,
    cwd: '..',
  },
});
