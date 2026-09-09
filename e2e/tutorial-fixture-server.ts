/** Local fixture host shared by the full matrix and focused tutorial runs. */
export const tutorialFixtureServer = {
  command: 'node apps/demo-react/node_modules/vite/bin/vite.js --config e2e/fixtures/vite.config.mjs',
  url: 'http://127.0.0.1:5793/tutorial-lifecycle/',
  reuseExistingServer: false,
  timeout: 120000,
  cwd: '..',
};
