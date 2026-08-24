import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config.js';

const browserNames = ['chromium', 'firefox', 'webkit'] as const;

export default defineConfig(baseConfig, {
  projects: browserNames.map((browserName) => ({
    name: browserName,
    use: { browserName },
  })),
});
