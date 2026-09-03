/**
 * Frozen inventories on a temporary fixture tree: selection rules, capture,
 * drift in bytes and in membership, symbolic links, and the Git-based
 * membership check replay uses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOST,
  freezeSnapshot,
  gitCandidates,
  globToRegExp,
  inventoryDigest,
  inventoryRow,
  listCandidates,
  readRepositoryFile,
  selectFromCandidates,
  unquoteGitPath,
  verifyLiveSnapshot,
  verifyMembershipAgainstGit,
  verifySnapshotBytes,
  verifyStoredSnapshot,
} from './inventory.mjs';
import { parseJson } from './json.mjs';
import { EvidenceCheckError } from './playwright.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const RULES = [
  { kind: 'files', paths: ['package.json', 'e2e/suite.browser.ts'] },
  { kind: 'glob', pattern: 'packages/*/package.json' },
  { kind: 'glob', pattern: 'packages/*/dist/**', buildOutput: true },
  { kind: 'glob', pattern: 'packages/core/src/**' },
  { kind: 'direct', dir: 'apps/demo', suffixes: ['.json', '.ts', '.html'] },
];

const UNIT = { selectionRules: RULES, snapshotKind: 'synthetic-input-snapshot', selectionText: { rules: ['synthetic'] } };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'evidence-inventory-'));
  const files = {
    'package.json': '{}\n',
    'e2e/suite.browser.ts': 'test\n',
    'packages/core/package.json': '{"name":"core"}\n',
    'packages/core/src/index.ts': 'export {};\n',
    'packages/core/src/deep/nested.ts': 'export {};\n',
    'packages/core/dist/index.js': 'built\n',
    'packages/core/dist/.hidden/map.js': 'built\n',
    'packages/other/package.json': '{"name":"other"}\n',
    'packages/other/src/ignored.ts': 'not selected\n',
    'apps/demo/package.json': '{}\n',
    'apps/demo/vite.config.ts': 'export default {};\n',
    'apps/demo/index.html': '<p></p>\n',
    'apps/demo/README.md': 'not selected\n',
    'apps/demo/.eslintrc.json': 'not selected\n',
    'apps/demo/src/main.ts': 'not selected by the direct rule\n',
    'outside.txt': 'not selected\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const fakeGit = (root, args) => {
  const key = args.join(' ');
  if (key === 'status --short') return ' M package.json\n?? e2e/suite.browser.ts\n';
  if (key === 'rev-parse HEAD') return 'a'.repeat(40) + '\n';
  if (key === 'branch --show-current') return 'feat/synthetic\n';
  throw new Error(`unexpected git ${key}`);
};

const EXPECTED = [
  'apps/demo/index.html',
  'apps/demo/package.json',
  'apps/demo/vite.config.ts',
  'e2e/suite.browser.ts',
  'package.json',
  'packages/core/dist/.hidden/map.js',
  'packages/core/dist/index.js',
  'packages/core/package.json',
  'packages/core/src/deep/nested.ts',
  'packages/core/src/index.ts',
  'packages/other/package.json',
];

test('selection rules pick exactly what the Python globs picked', () => {
  const root = fixture();
  try {
    const { selected, missingFiles } = selectFromCandidates(RULES, listCandidates(root, RULES));
    assert.deepEqual(selected, EXPECTED);
    assert.deepEqual(missingFiles, []);
    assert.deepEqual(selectFromCandidates(RULES, []).missingFiles, ['e2e/suite.browser.ts', 'package.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('globs match within one segment and a final ** matches everything below', () => {
  assert.ok(globToRegExp('packages/*/package.json').test('packages/a/package.json'));
  assert.ok(!globToRegExp('packages/*/package.json').test('packages/a/b/package.json'));
  assert.ok(globToRegExp('packages/*/dist/**').test('packages/a/dist/x/y.js'));
  assert.ok(!globToRegExp('packages/*/dist/**').test('packages/a/dist'));
  assert.ok(globToRegExp('a.b/*').test('a.b/.hidden'), 'pathlib globs match dotfiles');
  assert.ok(!globToRegExp('a.b/*').test('axb/c'), 'dots are literal');
  assert.throws(() => globToRegExp('a/**/b'), /final \*\*/);
});

test('a frozen snapshot verifies against the unchanged tree', () => {
  const root = fixture();
  const out = join(root, '..', `${root.split('/').pop()}-snapshot.json`);
  try {
    const summary = freezeSnapshot({ root, unit: UNIT, out, now: new Date('2026-09-27T06:42:23.158Z'), runGit: fakeGit });
    assert.equal(summary.files, EXPECTED.length);
    const snapshot = parseJson(readFileSync(out));
    assert.deepEqual(Object.keys(snapshot), ['kind', 'version', 'createdAt', 'gitHead', 'gitBranch', 'gitStatus', 'selection', 'inventory', 'inventorySha256']);
    assert.equal(snapshot.createdAt, '2026-09-27T06:42:23.158000+00:00');
    assert.deepEqual(snapshot.gitStatus, ['M package.json', '?? e2e/suite.browser.ts'], 'the first line loses its leading space, as Python strip() did');
    assert.deepEqual(snapshot.inventory.map((row) => row.path), EXPECTED);
    assert.deepEqual(verifyLiveSnapshot(snapshot, root, RULES), { files: EXPECTED.length });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { force: true });
  }
});

test('freezing never replaces an existing snapshot', () => {
  const root = fixture();
  const out = join(root, 'existing.json');
  try {
    writeFileSync(out, 'the pre-run snapshot\n');
    assert.throws(() => freezeSnapshot({ root, unit: UNIT, out, runGit: fakeGit }), /Refusing to replace/);
    assert.equal(readFileSync(out, 'utf8'), 'the pre-run snapshot\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('byte drift and membership drift are both detected', () => {
  const root = fixture();
  const out = join(root, '..', `${root.split('/').pop()}-snapshot.json`);
  try {
    freezeSnapshot({ root, unit: UNIT, out, runGit: fakeGit });
    const snapshot = parseJson(readFileSync(out));
    writeFileSync(join(root, 'packages/core/src/index.ts'), 'export const changed = 1;\n');
    assert.throws(() => verifyLiveSnapshot(snapshot, root, RULES), (error) => error.check === 'Changed input');
    writeFileSync(join(root, 'packages/core/src/index.ts'), 'export {};\n');
    writeFileSync(join(root, 'packages/core/src/added.ts'), 'export {};\n');
    assert.throws(() => verifyLiveSnapshot(snapshot, root, RULES), (error) => error.check === 'Selected inventory membership changed');
    rmSync(join(root, 'packages/core/src/added.ts'));
    rmSync(join(root, 'packages/core/dist/index.js'));
    assert.throws(() => verifyLiveSnapshot(snapshot, root, RULES), (error) => error.check === 'Captured input missing');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { force: true });
  }
});

test('symbolic links cannot pull files from outside the root', () => {
  const root = fixture();
  const outside = mkdtempSync(join(tmpdir(), 'evidence-outside-'));
  try {
    writeFileSync(join(outside, 'secret.ts'), 'outside\n');
    symlinkSync(join(outside, 'secret.ts'), join(root, 'packages/core/src/escape.ts'));
    assert.throws(() => listCandidates(root, RULES), (error) => error.check === 'Symbolic link escapes the repository');
    rmSync(join(root, 'packages/core/src/escape.ts'));
    symlinkSync(join(root, 'packages/core/src/index.ts'), join(root, 'packages/core/src/alias.ts'));
    symlinkSync(join(root, 'packages/core/src/deep'), join(root, 'packages/core/src/linked-dir'));
    const selected = selectFromCandidates(RULES, listCandidates(root, RULES)).selected;
    assert.ok(selected.includes('packages/core/src/alias.ts'), 'a link to a file inside the root counts as a file, as is_file() says');
    assert.ok(!selected.some((path) => path.startsWith('packages/core/src/linked-dir/')), 'linked directories are not followed');
    assert.throws(() => readRepositoryFile(root, '../outside.txt'), (error) => error.check === 'Unsafe inventory path');
    symlinkSync(join(outside, 'secret.ts'), join(root, 'apps/demo/linked.json'));
    assert.throws(() => listCandidates(root, RULES), (error) => error.check === 'Symbolic link escapes the repository', 'a directly selected file');
    assert.throws(() => readRepositoryFile(root, 'apps/demo/linked.json'), (error) => error.check === 'Inventory path resolves outside the repository');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('a stored snapshot is checked for digest, uniqueness, shape and order', () => {
  const rows = [inventoryRow('a.txt', Buffer.from('a')), inventoryRow('b.txt', Buffer.from('b'))];
  const good = { inventory: rows, inventorySha256: inventoryDigest(rows) };
  verifyStoredSnapshot(good);
  const broken = (mutate, check) => {
    const snapshot = structuredClone(good);
    mutate(snapshot);
    assert.throws(() => verifyStoredSnapshot(snapshot), (error) => error instanceof EvidenceCheckError && error.check === check, check);
  };
  broken((snapshot) => { snapshot.inventorySha256 = '0'.repeat(64); }, 'Snapshot inventory digest');
  broken((snapshot) => { snapshot.inventory.reverse(); snapshot.inventorySha256 = inventoryDigest(snapshot.inventory); }, 'Inventory order');
  broken((snapshot) => { snapshot.inventory[1].path = 'a.txt'; snapshot.inventorySha256 = inventoryDigest(snapshot.inventory); }, 'Duplicate inventory path');
  broken((snapshot) => { snapshot.inventory[0].path = '../a.txt'; snapshot.inventorySha256 = inventoryDigest(snapshot.inventory); }, 'Unsafe inventory path');
  broken((snapshot) => {
    snapshot.inventory[0] = { bytes: 1, path: 'a.txt', sha256: snapshot.inventory[0].sha256 };
    snapshot.inventorySha256 = inventoryDigest(snapshot.inventory);
  }, 'Inventory row shape');
});

test('rehashing reports lost files instead of passing them silently', () => {
  const rows = [inventoryRow('a.txt', Buffer.from('a')), inventoryRow('b.txt', Buffer.from('b'))];
  const snapshot = { inventory: rows, inventorySha256: inventoryDigest(rows) };
  const result = verifySnapshotBytes(snapshot, (path) => (path === 'b.txt' ? LOST : Buffer.from('a')));
  assert.deepEqual(result, { verified: 1, lost: [{ path: 'b.txt', bytes: 1, sha256: rows[1].sha256 }] });
  assert.throws(() => verifySnapshotBytes(snapshot, () => Buffer.from('x')), (error) => error.check === 'Changed input');
});

test('git status lines become membership candidates', () => {
  const status = [
    'M README.md',
    ' M packages/core/src/index.ts',
    '?? packages/core/src/new.ts',
    '?? packages/core/src/fresh/',
    ' D packages/core/src/gone.ts',
    'R  packages/core/src/old.ts -> packages/core/src/renamed.ts',
    'A  packages/core/src/staged.ts',
    '?? "packages/core/src/\\305\\275.ts"',
  ];
  const { files, untrackedDirectories } = gitCandidates(['README.md', 'packages/core/src/index.ts', 'packages/core/src/gone.ts', 'packages/core/src/old.ts'], status);
  assert.deepEqual(files.sort(), [
    'README.md',
    'packages/core/src/index.ts',
    'packages/core/src/new.ts',
    'packages/core/src/renamed.ts',
    'packages/core/src/staged.ts',
    `packages/core/src/${String.fromCodePoint(0x17d)}.ts`,
  ].sort());
  assert.deepEqual(untrackedDirectories, ['packages/core/src/fresh/']);
  assert.equal(unquoteGitPath('"a\\tb"'), 'a\tb');
});

test('membership against Git rebuilds tracked categories and reports what it trusted', () => {
  const rows = ['package.json', 'e2e/suite.browser.ts', 'packages/core/dist/index.js', 'packages/core/package.json', 'packages/core/src/fresh/a.ts', 'packages/core/src/index.ts']
    .sort()
    .map((path) => inventoryRow(path, Buffer.from(path)));
  const snapshot = { inventory: rows, inventorySha256: inventoryDigest(rows) };
  const tracked = ['package.json', 'packages/core/package.json', 'packages/core/src/index.ts', 'outside.txt'];
  const result = verifyMembershipAgainstGit(snapshot, RULES, gitCandidates(tracked, ['?? e2e/suite.browser.ts', '?? packages/core/src/fresh/']));
  assert.deepEqual(result, { rebuiltFromGit: 4, takenFromStoredList: 2, buildOutputRows: 1, untrackedDirectories: ['packages/core/src/fresh/'] });
  assert.throws(
    () => verifyMembershipAgainstGit(snapshot, RULES, gitCandidates([...tracked, 'packages/core/src/unlisted.ts'], ['?? e2e/suite.browser.ts', '?? packages/core/src/fresh/'])),
    (error) => error.check === 'Selected inventory membership changed'
  );
  assert.throws(
    () => verifyMembershipAgainstGit(snapshot, RULES, gitCandidates(tracked, ['?? packages/core/src/fresh/'])),
    (error) => error.check === 'Selected file missing'
  );
});

test('inventory digests recompute the committed values', () => {
  for (const path of ['e2e/paste-cleanup-results/2026-09-27-list-markers.json', 'e2e/paste-cleanup-results/2026-09-27-styled-breaks.json']) {
    const report = parseJson(readFileSync(join(repoRoot, path)));
    assert.equal(inventoryDigest(report.frozenInputs.inventory), report.frozenInputs.inventorySha256, path);
    verifyStoredSnapshot(report.frozenInputs);
  }
});
