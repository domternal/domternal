import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { earlierBundle } from './provenance.mjs';

const directories = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

/** An earlier output directory with one bundle and, when given, its listing file. */
function output(bundle, listing) {
  const directory = mkdtempSync(join(tmpdir(), 'content-performance-'));
  directories.push(directory);
  const nested = join(directory, 'earlier');
  mkdirSync(nested);
  writeFileSync(join(nested, 'head.js'), bundle);
  if (listing !== undefined) writeFileSync(join(nested, listing.name), JSON.stringify(listing.value));
  return { path: join(nested, 'head.js'), sha256: createHash('sha256').update(bundle).digest('hex') };
}

const COMMIT = 'daa1ce1b42798d9526ef7b49c8dd34daeddb8931';
const INPUTS = ['packages/core/dist/index.js'];

test('names the commit, inputs and state an earlier output recorded for the bundle, and no local path', () => {
  const sha256 = createHash('sha256').update('bundle').digest('hex');
  const bundle = output('bundle', { name: 'variants.json', value: [
    { label: 'v1.2.0', sha256: 'other', inputs: [] },
    { label: 'head', sha256, inputs: INPUTS, commit: COMMIT, dirty: false },
  ] });
  const found = earlierBundle(bundle.path, bundle.sha256);
  assert.deepEqual(found, { sha256, inputs: INPUTS, commit: COMMIT, dirty: false, bundledAs: 'head' });
  assert.ok(!JSON.stringify(found).includes(bundle.path));
});

test('reads the report of an output written before variants.json existed', () => {
  const sha256 = createHash('sha256').update('bundle').digest('hex');
  const bundle = output('bundle', { name: 'report.json', value: { variants: [{ label: 'head', sha256, inputs: INPUTS, commit: COMMIT, dirty: true }] } });
  assert.deepEqual(earlierBundle(bundle.path, bundle.sha256), { sha256, inputs: INPUTS, commit: COMMIT, dirty: true, bundledAs: 'head' });
});

test('carries the origin of a bundle that the earlier output took from a still earlier one', () => {
  const sha256 = createHash('sha256').update('bundle').digest('hex');
  const bundle = output('bundle', { name: 'variants.json', value: [
    { label: 'head', sha256, inputs: INPUTS, commit: COMMIT, dirty: false, bundledAs: 'current' },
  ] });
  assert.deepEqual(earlierBundle(bundle.path, bundle.sha256), { sha256, inputs: INPUTS, commit: COMMIT, dirty: false, bundledAs: 'current' });
});

test('refuses a bundle whose output does not record it with these bytes', () => {
  const recorded = output('bundle', { name: 'variants.json', value: [{ label: 'head', sha256: 'f'.repeat(64), inputs: INPUTS, commit: COMMIT, dirty: false }] });
  assert.throws(() => earlierBundle(recorded.path, recorded.sha256), /does not record head\.js with SHA-256/);
  const unrecorded = output('bundle');
  assert.throws(() => earlierBundle(unrecorded.path, unrecorded.sha256), /neither variants\.json nor report\.json/);
});

test('refuses a recorded bundle whose commit is unknown', () => {
  const sha256 = createHash('sha256').update('bundle').digest('hex');
  const bundle = output('bundle', { name: 'variants.json', value: [{ label: 'head', sha256, inputs: INPUTS }] });
  assert.throws(() => earlierBundle(bundle.path, bundle.sha256), /names no commit/);
});
