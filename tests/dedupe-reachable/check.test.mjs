/**
 * Fixture tests for the dedupe reachability gate.
 *
 * The gate exists because an unreachable `resolve.dedupe` entry is invisible on
 * Vite 8: no warning, no error, and the duplicate it was meant to prevent
 * survives. So the parser has to find every entry a config really declares, and
 * the reachability rule has to match how Vite resolves, from the project root
 * rather than from the importer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDedupe, isReachable, stripComments, collectConfigs, EXTRA_CONFIGS } from './check.mjs';

test('a single-line dedupe array is parsed', () => {
  assert.deepEqual(parseDedupe("dedupe: ['prosemirror-model', 'yjs']"), [
    'prosemirror-model',
    'yjs',
  ]);
});

test('a multi-line dedupe array is parsed', () => {
  const config = `
    export default defineConfig({
      resolve: {
        dedupe: [
          '@domternal/core',
          '@domternal/pm',
          'y-prosemirror',
        ],
      },
    });
  `;
  assert.deepEqual(parseDedupe(config), ['@domternal/core', '@domternal/pm', 'y-prosemirror']);
});

test('a comment inside the array does not become an entry', () => {
  // The real configs carry a paragraph of comment above the list and the
  // regex must not pick words out of it.
  const config = `
    dedupe: [
      // one copy of everything compared by identity
      'prosemirror-model',
    ],
  `;
  assert.deepEqual(parseDedupe(config), ['prosemirror-model']);
});

test('double quotes are parsed like single quotes', () => {
  assert.deepEqual(parseDedupe('dedupe: ["yjs"]'), ['yjs']);
});

test('a config with no dedupe yields nothing rather than throwing', () => {
  assert.deepEqual(parseDedupe('export default defineConfig({ resolve: { conditions: [] } });'), []);
});

test('an empty dedupe array yields nothing', () => {
  assert.deepEqual(parseDedupe('dedupe: []'), []);
});

test('a linked module is reachable, an absent one is not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dedupe-fixture-'));
  try {
    mkdirSync(join(dir, 'node_modules', '@domternal', 'pm'), { recursive: true });
    mkdirSync(join(dir, 'node_modules', 'prosemirror-model'), { recursive: true });
    assert.equal(isReachable(dir, '@domternal/pm'), true);
    assert.equal(isReachable(dir, 'prosemirror-model'), true);
    // The case the gate is for: named in dedupe, never linked at the root, so
    // Vite 8 ignores it and the duplicate survives.
    assert.equal(isReachable(dir, 'y-prosemirror'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reachability is judged at the project root, not by walking up', () => {
  /* Vite resolves a deduped id from the root it was given. A copy that only
     exists further up the tree is exactly the pnpm case this gate rejects, so
     finding it there would defeat the check. */
  const dir = mkdtempSync(join(tmpdir(), 'dedupe-fixture-'));
  try {
    mkdirSync(join(dir, 'node_modules', 'prosemirror-model'), { recursive: true });
    mkdirSync(join(dir, 'app'), { recursive: true });
    assert.equal(isReachable(join(dir, 'app'), 'prosemirror-model'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a nested array does not truncate the list at the inner bracket', () => {
  /* The shape `domternal.dev` actually ships: a conditional spread inside the
     array. A pattern that stops at the first `]` stops at the INNER one, which
     reads exactly like a shorter list, so the gate would quietly stop checking
     the entries after it and still print OK. */
  const config = `
    resolve: {
      dedupe: [
        '@domternal/core',
        '@domternal/pm',
        ...(proLocal ? ['@domternal/vanilla', '@domternal/extension-markdown'] : []),
        'yjs',
      ],
    },
  `;
  assert.deepEqual(parseDedupe(config), [
    '@domternal/core',
    '@domternal/pm',
    '@domternal/vanilla',
    '@domternal/extension-markdown',
    'yjs',
  ]);
});

test('prose inside the array is not mistaken for entries or for the end of it', () => {
  /* The real config explains itself in a long block comment INSIDE the array,
     and that prose carries both quoted phrases and square brackets. Either one
     alone is enough to make the gate report nonsense: quoted words arrive as
     module ids, a bracket ends the list early. */
  const config = `
    dedupe: [
      'yjs',
      /* The prosemirror-* packages are deliberately NOT listed. Naming
         'prosemirror-model' here makes the build fail with "Rollup failed to
         resolve import", and an array literal [like this one] in prose must
         not end the list either. */
      // 'y-protocols' is handled by its subpaths
      'y-prosemirror',
    ],
  `;
  assert.deepEqual(parseDedupe(config), ['yjs', 'y-prosemirror']);
});

test('stripComments leaves a URL inside a string alone', () => {
  const text = "const docs = 'https://domternal.dev/v1/guides/single-prosemirror-copy/';";
  assert.equal(stripComments(text), text);
});

test('the site config is what the extra list is for', () => {
  /* The one dedupe list in this repo that reaches production, and the one an
     apps-only walk misses: it is a nested project with its own node_modules. */
  assert.ok(EXTRA_CONFIGS.includes('domternal.dev/astro.config.mjs'));
});

test('collectConfigs skips what is absent rather than failing', () => {
  const root = mkdtempSync(join(tmpdir(), 'dedupe-configs-'));
  try {
    // No apps directory and no extras present: an empty result, not a throw,
    // so a partial checkout still passes the gate.
    assert.deepEqual(collectConfigs(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('collectConfigs finds an app config and pairs it with its own directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'dedupe-configs-'));
  try {
    const app = join(root, 'apps', 'demo');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'vite.config.ts'), "dedupe: ['yjs']");
    const found = collectConfigs(root);
    assert.equal(found.length, 1);
    // The directory matters as much as the file: reachability is judged from
    // the project root that OWNS the config, not from the repo root.
    assert.equal(found[0].dir, app);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
