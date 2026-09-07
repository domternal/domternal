import { defineConfig } from '@playwright/test';
import crossBrowserConfig from './playwright.cross-browser.config.js';
import { tutorialFixtureServer } from './tutorial-fixture-server.js';

export default defineConfig({
  ...crossBrowserConfig,
  testMatch: [
    'tutorial-lifecycle.spec.ts',
    'tutorial-toc-storage.spec.ts',
    'tutorial-slash-contracts.spec.ts',
    'tutorial-input-contracts.spec.ts',
  ],
  webServer: tutorialFixtureServer,
});
