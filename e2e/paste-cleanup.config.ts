import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['block-background.browser.ts', 'paste-block-background.browser.ts', 'paste-cleanup.browser.ts', 'paste-feedback.browser.ts', 'paste-assets.browser.ts', 'paste-resolver.browser.ts', 'paste-destination.browser.ts', 'paste-breaks.browser.ts', 'paste-color-alpha.browser.ts', 'paste-word-typography.browser.ts', 'paste-passthrough.browser.ts', 'paste-content-witness.browser.ts', 'paste-first-paragraph.browser.ts', 'paste-trusted-types.browser.ts', 'paste-list-markers.browser.ts', 'paste-zero-start.browser.ts', 'paste-slice-context.browser.ts', 'paste-heading-levels.browser.ts', 'transaction-contract.browser.ts', 'paste-table-cells.browser.ts', 'paste-image-files.browser.ts', 'paste-open-slice.browser.ts', 'paste-loose-inline.browser.ts', 'paste-structure.browser.ts', 'paste-native-fixtures.browser.ts', 'content-contrast.browser.ts', 'text-color-readability.browser.ts'],
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
