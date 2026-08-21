import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const angularWorkspace = JSON.parse(
  readFileSync(new URL('../../apps/demo-angular/angular.json', import.meta.url), 'utf8')
);

test('Angular persistent cache stays disabled', () => {
  assert.equal(
    angularWorkspace?.cli?.cache?.enabled,
    false,
    'apps/demo-angular/angular.json must explicitly set cli.cache.enabled to false'
  );
});
