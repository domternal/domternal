/**
 * Tests for the release readiness guard.
 *
 * The guard only matters on the path a maintainer actually takes, so the
 * fixture tests run the real transform, `pnpm publish`, `pnpm pack` and
 * `pnpm add` in a throwaway workspace built from copies of the real scripts.
 * None of them can publish anything: every publish is a dry run against a
 * registry address nothing listens on, with empty npm and pnpm config files and
 * no inherited credential or registry setting.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  preparePublishManifest,
  publishBlockers,
} from '../../scripts/prepare-publish-manifest.mjs';
import {
  READINESS_PATH,
  parseReadiness,
  publishRefusal,
  readinessProblems,
  releaseRefusal,
} from '../../scripts/release-readiness.mjs';
import { refusalProblems, runTransformCopy, transformOutsidePublish } from './check.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Port 9 is the discard service: nothing answers there, so even a publish that
// forgot --dry-run could not reach a registry.
const DEAD_REGISTRY = 'http://127.0.0.1:9';
const HELD = '@fixture/held';
const HELD_REASON = 'waits for its fixture qualification';
const PREPARED =
  '[prepare-publish] @fixture/ready: dropped devDependencies; removed the @domternal/source condition';

function tempDirectory(t, prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** The pnpm this repository pins, so every fixture runs the same one CI runs. */
function packageManager() {
  return JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')).packageManager;
}

function writeReadiness(root, unreleased) {
  writeFileSync(
    join(root, 'scripts/release-readiness.json'),
    `${JSON.stringify({ $comment: 'fixture', unreleased }, null, 2)}\n`
  );
}

function fixtureManifest(name) {
  return {
    name: `@fixture/${name}`,
    version: '1.3.0',
    type: 'module',
    exports: { '.': { '@domternal/source': './src/index.js', default: './dist/index.js' } },
    files: ['dist'],
    scripts: {
      build: 'node build.mjs',
      prepack: 'node -e "console.log(\'fixture prepack ran\')"',
      prepublishOnly: 'pnpm build && node ../../scripts/prepare-publish-manifest.mjs',
    },
    devDependencies: { typescript: '~5.9.3' },
  };
}

/**
 * A two-package workspace: `held` is listed as unreleased, `ready` is not.
 * Both carry what the real packages carry into the transform: a build, a
 * prepack, the dev-source condition and devDependencies.
 */
function fixtureWorkspace(t, unreleased = { [HELD]: HELD_REASON }) {
  const root = tempDirectory(t, 'domternal-release-readiness-');
  mkdirSync(join(root, 'scripts'));
  for (const file of readdirSync(join(repository, 'scripts'))) {
    if (file.endsWith('.mjs'))
      copyFileSync(join(repository, 'scripts', file), join(root, 'scripts', file));
  }
  writeReadiness(root, unreleased);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'release-readiness-fixture',
      private: true,
      packageManager: packageManager(),
    })
  );
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  // npm refuses one file loaded as both user and global config, so two.
  writeFileSync(join(root, 'empty-user-npmrc'), '');
  writeFileSync(join(root, 'empty-global-npmrc'), '');
  for (const name of ['held', 'ready']) {
    const directory = join(root, 'packages', name);
    mkdirSync(join(directory, 'src'), { recursive: true });
    writeFileSync(join(directory, 'src/index.js'), `export const fixture = '${name}';\n`);
    writeFileSync(
      join(directory, 'build.mjs'),
      "import { copyFileSync, mkdirSync } from 'node:fs';\n" +
        "mkdirSync('dist', { recursive: true });\n" +
        "copyFileSync('src/index.js', 'dist/index.js');\n" +
        "console.log('fixture build ran');\n"
    );
    writeFileSync(
      join(directory, 'package.json'),
      `${JSON.stringify(fixtureManifest(name), null, 2)}\n`
    );
  }
  return root;
}

/** The inherited environment without anything that could name a registry or carry a credential. */
function isolatedEnv(root) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(npm|pnpm)_config_/i.test(key) || /token|auth|password/i.test(key)) continue;
    env[key] = value;
  }
  return {
    ...env,
    // pnpm reads a global rc of its own from here, apart from both npmrc files.
    // Left at its default, a maintainer's pnpm-level ignore-scripts, registry or
    // token would reach the fixtures. Nothing puts an rc in this directory.
    XDG_CONFIG_HOME: join(root, 'empty-pnpm-config'),
    npm_config_userconfig: join(root, 'empty-user-npmrc'),
    npm_config_globalconfig: join(root, 'empty-global-npmrc'),
    npm_config_registry: DEAD_REGISTRY,
    npm_config_cache: join(root, 'npm-cache'),
    npm_config_fetch_retries: '0',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  };
}

function run(command, args, cwd, root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
    env: isolatedEnv(root),
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, output: result.stdout + result.stderr };
}

function dryRunPublish(root, name) {
  return run(
    'pnpm',
    ['publish', '--dry-run', '--no-git-checks', '--registry', DEAD_REGISTRY],
    join(root, 'packages', name),
    root
  );
}

function manifestBytes(root, name) {
  return readFileSync(join(root, 'packages', name, 'package.json'));
}

test('the list parses into package names and the reason each one waits', () => {
  assert.deepEqual(parseReadiness('{"unreleased": {}}'), new Map());
  assert.deepEqual(
    parseReadiness(
      JSON.stringify({
        $comment: 'why',
        unreleased: { '@domternal/a': 'first', '@domternal/b': 'second' },
      })
    ),
    new Map([
      ['@domternal/a', 'first'],
      ['@domternal/b', 'second'],
    ])
  );
});

test('any list shape that could read as "nothing held" is refused', () => {
  for (const [text, message] of [
    ['[]', /must be a JSON object/],
    ['null', /must be a JSON object/],
    ['"@domternal/a"', /must be a JSON object/],
    ['{}', /"unreleased" must be an object/],
    ['{"unreleased": []}', /"unreleased" must be an object/],
    ['{"unreleased": null}', /"unreleased" must be an object/],
    ['{"unreleased": {"@domternal/a": true}}', /"@domternal\/a" needs a non-empty reason/],
    ['{"unreleased": {"@domternal/a": "  "}}', /"@domternal\/a" needs a non-empty reason/],
    ['{"unreleased": {"": "reason"}}', /empty package name/],
    ['{"unreleased": {}, "released": {"@domternal/a": "x"}}', /unknown key "released"/],
    ['{"$comment": 1, "unreleased": {}}', /"\$comment" must be a string/],
    ['{"unreleased": {}', /JSON/],
  ]) {
    assert.throws(() => parseReadiness(text), message, text);
  }
});

test('a listed package is refused with its reason, and an unlisted one is not', () => {
  const held = new Map([[HELD, HELD_REASON]]);
  assert.equal(releaseRefusal(HELD, held), `${HELD} is not releasable yet: ${HELD_REASON}`);
  assert.equal(releaseRefusal('@fixture/ready', held), null);
  assert.equal(releaseRefusal(undefined, held), null);
});

test('an entry naming no package, or a private package, is reported', () => {
  const held = new Map([
    ['@domternal/gone', 'stale'],
    ['@domternal/hidden', 'private'],
    ['@domternal/kept', 'fine'],
  ]);
  const problems = readinessProblems(held, [
    { name: '@domternal/hidden', private: true },
    { name: '@domternal/kept' },
  ]);
  assert.equal(problems.length, 2);
  assert.match(
    problems[0],
    /@domternal\/gone is listed as unreleased, but no package in this workspace has that name/
  );
  assert.match(
    problems[1],
    /@domternal\/hidden .* "private": true.*package-policy, package-artifacts/
  );
  assert.deepEqual(readinessProblems(new Map(), [{ name: '@domternal/kept' }]), []);
});

test('only prepublishOnly may run the publish transform', () => {
  const hook = 'pnpm build && node ../../scripts/prepare-publish-manifest.mjs';
  assert.deepEqual(
    transformOutsidePublish([
      { name: '@domternal/a', scripts: { prepublishOnly: hook, build: 'tsup' } },
    ]),
    []
  );
  const problems = transformOutsidePublish([
    {
      name: '@domternal/a',
      scripts: { prepack: 'node ../../scripts/prepare-publish-manifest.mjs' },
    },
    { name: '@domternal/b', scripts: { build: `tsup && ${hook}` } },
  ]);
  assert.equal(problems.length, 2);
  assert.match(
    problems[0],
    /@domternal\/a: the "prepack" script runs prepare-publish-manifest\.mjs/
  );
  assert.match(problems[1], /@domternal\/b: the "build" script/);
});

test('correctness checks know nothing about readiness', (t) => {
  /* The guard must stay out of the pure transform and out of publishBlockers,
     which package-policy and package-artifacts run on every package, the
     unreleased ones included. Each package the real list holds, and a fixture
     one, must pass them unchanged while it is held. */
  const real = parseReadiness(readFileSync(READINESS_PATH, 'utf8'));
  for (const name of [...real.keys(), HELD]) {
    const directory = tempDirectory(t, 'domternal-readiness-blockers-');
    mkdirSync(join(directory, 'dist'));
    writeFileSync(join(directory, 'dist/index.js'), 'export {};\n');
    const manifest = { ...fixtureManifest('held'), name };
    const { prepared, changes } = preparePublishManifest(manifest);
    assert.deepEqual(changes, [
      'dropped devDependencies',
      'removed the @domternal/source condition',
    ]);
    assert.deepEqual(publishBlockers(prepared, directory), [], name);
  }
});

test('the transform refuses a listed package before rewriting its manifest', (t) => {
  const root = fixtureWorkspace(t);
  const before = manifestBytes(root, 'held');
  const refused = run(
    process.execPath,
    ['scripts/prepare-publish-manifest.mjs', 'packages/held'],
    root,
    root
  );
  assert.equal(refused.status, 1, refused.output);
  assert.match(
    refused.output,
    /\[release-readiness\] @fixture\/held is not releasable yet: waits for its fixture qualification/
  );
  assert.match(
    refused.output,
    /Remove its entry from scripts\/release-readiness\.json in the release pull request\. Nothing was written\./
  );
  assert.ok(manifestBytes(root, 'held').equals(before), 'the refused manifest was rewritten');

  const built = run('pnpm', ['run', 'build'], join(root, 'packages/ready'), root);
  assert.equal(built.status, 0, built.output);
  const allowed = run(
    process.execPath,
    ['scripts/prepare-publish-manifest.mjs', 'packages/ready'],
    root,
    root
  );
  assert.equal(allowed.status, 0, allowed.output);
  assert.ok(allowed.output.includes(PREPARED), allowed.output);
  const rewritten = JSON.parse(manifestBytes(root, 'ready').toString('utf8'));
  assert.equal(rewritten.devDependencies, undefined);
  assert.deepEqual(rewritten.exports, { '.': { default: './dist/index.js' } });
});

test('pnpm publish of a listed package stops at prepublishOnly and leaves the manifest alone', (t) => {
  const root = fixtureWorkspace(t);
  const before = manifestBytes(root, 'held');
  const refused = dryRunPublish(root, 'held');
  assert.notEqual(refused.status, 0, refused.output);
  assert.match(refused.output, /\[release-readiness\] @fixture\/held is not releasable yet/);
  // The build ran first, which is allowed; nothing after the refusal did.
  assert.match(refused.output, /fixture build ran/);
  assert.doesNotMatch(refused.output, /fixture prepack ran/);
  assert.doesNotMatch(refused.output, /\+ @fixture\/held@/);
  assert.ok(manifestBytes(root, 'held').equals(before), 'the refused manifest was rewritten');
});

test('pnpm publish of an unlisted package goes through the rewrite', (t) => {
  const root = fixtureWorkspace(t);
  const published = dryRunPublish(root, 'ready');
  assert.equal(published.status, 0, published.output);
  const order = [PREPARED, 'fixture prepack ran', '+ @fixture/ready@1.3.0'].map((marker) =>
    published.stdout.indexOf(marker)
  );
  assert.ok(
    order.every((index) => index >= 0),
    published.output
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    published.output
  );
  assert.equal(
    JSON.parse(manifestBytes(root, 'ready').toString('utf8')).devDependencies,
    undefined
  );
});

test('a listed package still builds, packs and installs from its tarball', (t) => {
  const root = fixtureWorkspace(t);
  const directory = join(root, 'packages/held');
  const before = manifestBytes(root, 'held');
  const archives = join(root, 'archives');

  const built = run('pnpm', ['run', 'build'], directory, root);
  assert.equal(built.status, 0, built.output);
  const packed = run('pnpm', ['pack', '--pack-destination', archives], directory, root);
  assert.equal(packed.status, 0, packed.output);
  assert.match(packed.output, /fixture prepack ran/);
  assert.doesNotMatch(packed.output, /\[release-readiness\]/);
  assert.ok(manifestBytes(root, 'held').equals(before), 'packing rewrote the manifest');

  const [tarball] = readdirSync(archives);
  assert.equal(tarball, 'fixture-held-1.3.0.tgz');
  const listed = spawnSync('tar', ['-xOzf', join(archives, tarball), 'package/package.json'], {
    encoding: 'utf8',
  });
  assert.equal(listed.status, 0, listed.stderr);
  const packedManifest = JSON.parse(listed.stdout);
  assert.equal(packedManifest.name, HELD);
  assert.equal(packedManifest.version, '1.3.0');

  // A clean consumer outside the workspace, the way a CI job installs packed
  // tarballs. Offline, with a store of its own, so only the tarball can resolve.
  const consumer = tempDirectory(t, 'domternal-readiness-consumer-');
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'consumer', private: true, packageManager: packageManager() })
  );
  const installed = run(
    'pnpm',
    [
      'add',
      '--offline',
      '--ignore-scripts',
      '--store-dir',
      join(root, 'store'),
      '--registry',
      DEAD_REGISTRY,
      join(archives, tarball),
    ],
    consumer,
    root
  );
  assert.equal(installed.status, 0, installed.output);
  const imported = run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const { fixture } = await import('@fixture/held'); console.log(fixture);",
    ],
    consumer,
    root
  );
  assert.equal(imported.status, 0, imported.output);
  assert.equal(imported.stdout.trim(), 'held');
});

test('emptying the list is the only switch, and a missing list refuses everything', (t) => {
  const root = fixtureWorkspace(t);
  const list = join(root, 'scripts/release-readiness.json');
  const before = manifestBytes(root, 'held');

  // A dry run is not a way around it: prepublishOnly runs in dry runs too.
  assert.notEqual(dryRunPublish(root, 'held').status, 0);

  rmSync(list);
  for (const name of ['held', 'ready']) {
    const refused = run(
      process.execPath,
      ['scripts/prepare-publish-manifest.mjs', `packages/${name}`],
      root,
      root
    );
    assert.equal(refused.status, 1, refused.output);
    assert.match(
      refused.output,
      new RegExp(
        `\\[release-readiness\\] @fixture/${name} was not published: scripts/release-readiness\\.json is missing or invalid`
      )
    );
    assert.match(refused.output, /A release empties "unreleased" and never deletes the file\./);
  }
  assert.notEqual(dryRunPublish(root, 'ready').status, 0);

  writeFileSync(list, '{"unreleased": ');
  assert.equal(
    run(process.execPath, ['scripts/prepare-publish-manifest.mjs', 'packages/ready'], root, root)
      .status,
    1
  );

  writeReadiness(root, { [HELD]: 'a different reason is still a hold' });
  assert.notEqual(dryRunPublish(root, 'held').status, 0);
  assert.ok(manifestBytes(root, 'held').equals(before), 'a refused publish rewrote the manifest');

  writeReadiness(root, {});
  const released = dryRunPublish(root, 'held');
  assert.equal(released.status, 0, released.output);
  assert.match(released.stdout, /\+ @fixture\/held@1\.3\.0/);
});

test('the guard reads its own list when called in process, and refuses when it is unreadable', (t) => {
  const directory = tempDirectory(t, 'domternal-readiness-list-');
  const list = join(directory, 'list.json');
  writeFileSync(list, JSON.stringify({ unreleased: { [HELD]: HELD_REASON } }));
  assert.deepEqual(publishRefusal(HELD, list), [
    `[release-readiness] ${HELD} is not releasable yet: ${HELD_REASON}`,
    `Remove its entry from ${list} in the release pull request. Nothing was written.`,
  ]);
  assert.equal(publishRefusal('@fixture/ready', list), null);
  assert.match(
    publishRefusal('@fixture/ready', join(directory, 'missing.json'))[0],
    /missing or invalid/
  );
});

test('the gate judges a transform run by exit status, refusal and manifest bytes together', () => {
  const held = new Map([[HELD, HELD_REASON]]);
  const entry = (name) => ({ manifest: { name } });
  const refusal = `[release-readiness] ${HELD} is not releasable yet: ${HELD_REASON}\n`;
  assert.deepEqual(
    refusalProblems(entry(HELD), held, { status: 1, output: refusal, unchanged: true }),
    []
  );
  for (const run of [
    { status: 0, output: '[prepare-publish] @fixture/held: nothing to change', unchanged: false },
    {
      status: 1,
      output: '[prepare-publish] @fixture/held must not be published:',
      unchanged: true,
    },
    { status: 1, output: refusal, unchanged: false },
  ]) {
    assert.match(
      refusalProblems(entry(HELD), held, run)[0],
      /did not refuse it for readiness before touching its manifest/
    );
  }
  for (const output of [
    '[prepare-publish] @fixture/ready must not be published:',
    '[prepare-publish] @fixture/ready: nothing to change',
  ]) {
    assert.deepEqual(
      refusalProblems(entry('@fixture/ready'), held, { status: 1, output, unchanged: true }),
      []
    );
  }
  // A transform that never ran, for example because it was started through a
  // path that did not match its module URL, proves nothing either way.
  assert.match(
    refusalProblems(entry('@fixture/ready'), held, { status: 0, output: '', unchanged: true })[0],
    /said nothing about it/
  );
  assert.match(
    refusalProblems(entry('@fixture/ready'), held, {
      status: 1,
      output: '[release-readiness] @fixture/ready was not published',
      unchanged: true,
    })[0],
    /not listed as unreleased, but the publish transform refused it/
  );
});

test('the gate runs the real transform on a copy and never touches the package itself', (t) => {
  const root = fixtureWorkspace(t);
  const entry = (name) => ({
    directory: join(root, 'packages', name),
    name,
    manifest: fixtureManifest(name),
  });
  const before = manifestBytes(root, 'held');
  const refused = runTransformCopy(entry('held'), root);
  assert.equal(refused.status, 1, refused.output);
  assert.ok(refused.unchanged);
  assert.match(refused.output, /\[release-readiness\] @fixture\/held is not releasable yet/);
  const allowed = runTransformCopy(entry('ready'), root);
  assert.doesNotMatch(allowed.output, /\[release-readiness\]/);
  // The copy has no dist, so the transform's own blockers stop it, past the guard.
  assert.match(allowed.output, /\[prepare-publish\] @fixture\/ready must not be published/);
  assert.ok(manifestBytes(root, 'held').equals(before));
});
