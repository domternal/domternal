/**
 * Root matrix e2e config: starts all four demo apps and runs every spec in
 * this directory against each of them (specs loop over e2e/targets.ts).
 * Per-app suites under each app's e2e directory are the legacy layout; NEW
 * cross-framework behavior specs belong here.
 *
 * Angular caveat: after rebuilding any package dist the demo consumes, clear
 * the build cache first (rm -rf apps/demo-angular/.angular) or ng serve
 * serves stale dependencies.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 30000,
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  reporter: 'line',
  use: {
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter demo-vanilla start --port 5199 --strictPort',
      url: 'http://localhost:5199',
      reuseExistingServer: !process.env['CI'],
      timeout: 120000,
      cwd: '..',
    },
    {
      command: 'pnpm --filter demo-react start --port 5299 --strictPort',
      url: 'http://localhost:5299',
      reuseExistingServer: !process.env['CI'],
      timeout: 120000,
      cwd: '..',
    },
    {
      command: 'pnpm --filter demo-vue start --port 5499 --strictPort',
      url: 'http://localhost:5499',
      reuseExistingServer: !process.env['CI'],
      timeout: 120000,
      cwd: '..',
    },
    {
      command: 'rm -rf apps/demo-angular/.angular && pnpm --filter demo-angular start --port 5399',
      url: 'http://localhost:5399',
      reuseExistingServer: !process.env['CI'],
      timeout: 180000,
      cwd: '..',
    },
  ],
});
