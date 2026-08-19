/**
 * Fixture tests for the notice gate's two readers: the tsup config parser that
 * decides what a package bundles, and the notice reader that decides whether
 * the bundling was declared and licensed properly.
 *
 * Both halves are latent in this repository, since nothing declares
 * `noExternal` today, so nothing else exercises them. Without these tests the
 * discovery could be broken for a year and the gate would keep printing OK,
 * which is the same silent failure the gate exists to prevent, one level up.
 *
 * Two of the cases below are the inputs a review used to walk past the gate:
 * a notice declaring "remend-utils (MIT)" while remend is what ships bundled,
 * and a config that keeps its settings in a shared base one directory up. Both
 * are kept here verbatim, because a gate that once had a way through is worth
 * testing with the way through.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED,
  MIT_SENTENCE,
  TSUP_CONFIGS,
  auditBundled,
  bundledDeclarations,
  deniesBundling,
  escapeForRegExp,
  findHiddenConfig,
  licenseDemands,
  mentionsPackage,
  parseNoExternal,
  readArrayLiteral,
  readSpreadOperand,
  readTsupBundling,
  saysBundled,
  sections,
  stripComments,
  unreadableReason,
} from './check.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* ---------------------------------------------------------------------------
   Reading what a package bundles out of its tsup config.
--------------------------------------------------------------------------- */

test('a plain noExternal list is read as bundled dependencies', () => {
  const config = "export default defineConfig({ noExternal: ['remend', 'lodash-es'] });";
  const [declaration] = parseNoExternal(config);
  assert.equal(declaration.readable, true);
  assert.deepEqual(declaration.bundled, ['remend', 'lodash-es']);
});

test('double quotes and line breaks are read the same way', () => {
  const config = `
export default defineConfig({
  noExternal: [
    "remend",
    'lodash-es',
  ],
});`;
  assert.deepEqual(parseNoExternal(config)[0].bundled, ['remend', 'lodash-es']);
});

test('an empty noExternal list is readable and bundles nothing', () => {
  const [declaration] = parseNoExternal('export default defineConfig({ noExternal: [] });');
  assert.equal(declaration.readable, true);
  assert.deepEqual(declaration.bundled, []);
});

test('a config with no noExternal yields no declarations', () => {
  assert.deepEqual(parseNoExternal("export default defineConfig({ external: ['@domternal/core'] });"), []);
});

test('a regex entry is reported as unreadable, not read as an empty list', () => {
  // The whole hazard is a declaration that bundles something this cannot name.
  // Treating it as "nothing bundled" would be the gate lying by omission.
  const [declaration] = parseNoExternal('export default defineConfig({ noExternal: [/^lodash/] });');
  assert.equal(declaration.readable, false);
});

test('an identifier entry is reported as unreadable', () => {
  const [declaration] = parseNoExternal('export default defineConfig({ noExternal: [...bundledDeps] });');
  assert.equal(declaration.readable, false);
});

test('a noExternal that is not an array at all is reported, not missed', () => {
  // `noExternal: bundledDeps` matches no `[...]`, so a parser that only looks
  // for brackets sees a package that bundles nothing. This one sees a package
  // it cannot vouch for.
  const [declaration] = parseNoExternal('export default defineConfig({ noExternal: bundledDeps });');
  assert.equal(declaration.readable, false);
  assert.match(declaration.value, /bundledDeps/);
});

test('a template literal entry is reported as unreadable', () => {
  const config = 'export default defineConfig({ noExternal: [`@scope/${name}`] });';
  assert.equal(parseNoExternal(config)[0].readable, false);
});

test('every noExternal in a multi-config file is collected', () => {
  const config = `
export default defineConfig([
  { entry: ['src/index.ts'], noExternal: ['remend'] },
  { entry: ['src/worker.ts'], noExternal: ['idb'] },
]);`;
  assert.deepEqual(
    parseNoExternal(config).flatMap((declaration) => declaration.bundled),
    ['remend', 'idb']
  );
});

test('a commented-out noExternal is not a bundling instruction', () => {
  const config = `
export default defineConfig({
  // noExternal: ['remend'],
  /* noExternal: ['idb'], */
  external: ['@domternal/core'],
});`;
  assert.deepEqual(parseNoExternal(config), []);
});

test('stripComments leaves a URL inside a string intact', () => {
  assert.ok(stripComments("const url = 'https://domternal.dev/';").includes('https://domternal.dev/'));
});

test('a bracket inside a quoted entry does not end the list early', () => {
  const text = "['we]ird', 'remend']";
  assert.equal(readArrayLiteral(text, 0), "'we]ird', 'remend'");
});

test('readArrayLiteral returns null when the list never closes', () => {
  assert.equal(readArrayLiteral("['remend'", 0), null);
});

/* ---------------------------------------------------------------------------
   A config that keeps part of its configuration somewhere else.
--------------------------------------------------------------------------- */

test('a config built on a shared base is reported, not read as bundling nothing', () => {
  // The escape hatch left by reading `noExternal` alone: the declaration is
  // not unreadable, it is in another file. This text contains no `noExternal`,
  // which to a scan of this file alone is indistinguishable from a package
  // that bundles nothing, so the base could inline anything and no notice
  // would ever be demanded for it.
  const config = `
import base from '../../tsup.base.ts';

export default defineConfig({ ...base, entry: ['src/index.ts'] });
`;
  assert.deepEqual(parseNoExternal(config), []);

  const declarations = readTsupBundling(config);
  assert.ok(declarations.length > 0, 'the config must be reported, not scanned clean');
  assert.ok(declarations.every((declaration) => declaration.readable === false));
  assert.ok(
    declarations.some(
      (declaration) => declaration.origin === 'import' && declaration.value.includes('tsup.base.ts')
    ),
    'the imported config must be named'
  );
  assert.ok(
    declarations.some(
      (declaration) => declaration.origin === 'spread' && declaration.value.includes('base')
    ),
    'the spread of a value written elsewhere must be reported'
  );
});

test('the report names the file and says what to do about it', () => {
  const config = "import base from './tsup.shared.ts';\nexport default defineConfig({ ...base });\n";
  const reasons = findHiddenConfig(config).map((declaration) => unreadableReason(declaration));
  assert.ok(reasons.some((reason) => reason.includes('tsup.shared.ts')));
  assert.ok(reasons.every((reason) => /self-contained|written in this config|teach/.test(reason)));
});

test('a config that exports anything but a literal is reported', () => {
  for (const config of [
    "import base from '../../base.ts';\nexport default base;\n",
    "import base from '../../base.ts';\nexport default defineConfig(base);\n",
    "import { withBase } from '../../build.ts';\nexport default defineConfig(withBase({ entry: [] }));\n",
    "export { default } from '../../shared.ts';\n",
  ]) {
    assert.ok(
      findHiddenConfig(config).some((declaration) => declaration.origin === 'export'),
      `${config} must not read as a config this check can vouch for`
    );
  }
});

test('a self-contained config is read rather than reported', () => {
  // A spread of an object literal written in the same file hides nothing: the
  // `noExternal` scan reads the whole file, wherever the setting sits in it.
  const config = `
import { defineConfig } from 'tsup';

const shared = { format: ['esm'], target: 'es2022' };

export default defineConfig({
  ...shared,
  entry: ['src/index.ts'],
  noExternal: ['remend'],
});
`;
  assert.deepEqual(findHiddenConfig(config), []);
  assert.deepEqual(
    readTsupBundling(config).flatMap((declaration) => declaration.bundled),
    ['remend']
  );
});

test('a spread operand is read whole, brackets and all', () => {
  assert.equal(readSpreadOperand('...withBase({ a: 1 }), entry: []', 3), 'withBase({ a: 1 })');
});

test('every tsup config in this repository reads as self-contained', () => {
  // Reporting what it cannot read only costs something if a real config trips
  // it. None do, which is what makes the rule above free to keep.
  const packagesDir = join(repoRoot, 'packages');
  let scanned = 0;
  for (const name of readdirSync(packagesDir)) {
    for (const file of TSUP_CONFIGS) {
      const path = join(packagesDir, name, file);
      if (!existsSync(path)) continue;
      scanned += 1;
      const unreadable = readTsupBundling(readFileSync(path, 'utf8')).filter(
        (declaration) => !declaration.readable
      );
      assert.deepEqual(
        unreadable.map((declaration) => unreadableReason(declaration)),
        [],
        `packages/${name}/${file}`
      );
    }
  }
  assert.ok(scanned > 0, 'the configs must actually be found');
});

/* ---------------------------------------------------------------------------
   Reading whether the notice declares the bundling.
--------------------------------------------------------------------------- */

test('a heading that says bundled opens a bundled section', () => {
  assert.equal(saysBundled('Bundled dependencies'), true);
  assert.equal(saysBundled('Dependencies bundled into dist'), true);
  assert.equal(saysBundled('Inlined code'), true);
});

test('a heading that DENIES bundling does not open a bundled section', () => {
  // "Not bundled" contains the word bundled. Reading it as a declaration would
  // let the exact mistake this gate exists for pass as its own fix.
  assert.equal(saysBundled('Not bundled'), false);
  assert.equal(saysBundled('Dependencies that are not bundled'), false);
  assert.equal(saysBundled('Externalised dependencies'), false);
});

test('a heading about nothing in particular opens nothing', () => {
  assert.equal(saysBundled('Third-party licenses'), false);
});

test('only affirmatively bundled sections are searched for a dependency', () => {
  const notice = `# Third-party licenses

## Bundled dependencies

remend, MIT.

## Not bundled

idb ships as its own package.
`;
  const declared = bundledDeclarations(notice);
  assert.ok(declared.includes('remend'));
  assert.ok(!declared.includes('idb'));
});

test('a dependency named in the heading itself counts as declared', () => {
  assert.ok(bundledDeclarations('## Bundled: remend\n\nMIT.\n').includes('remend'));
});

test('sections split at every heading level', () => {
  const found = sections('# One\na\n### Two\nb\n');
  assert.deepEqual(
    found.map((section) => section.heading),
    ['One', 'Two']
  );
});

test('a "not bundled" claim is caught, and scoped or dotted names are matched literally', () => {
  assert.equal(deniesBundling('remend is not bundled, it stays external.', 'remend'), true);
  assert.equal(deniesBundling('Not bundled: @scope/name.', '@scope/name'), true);
  assert.equal(deniesBundling('lodash.merge is not bundled.', 'lodash.merge'), true);
  assert.equal(deniesBundling('remend is bundled into dist.', 'remend'), false);
});

test('a name is matched as a whole npm name, never as a substring', () => {
  // The defeating input: "remend-utils (MIT)" contains "remend", so a substring
  // test reads the neighbour's line as a declaration for remend, and the MIT
  // sentence written for the neighbour answers for a package whose own license
  // was never reproduced.
  assert.equal(mentionsPackage('This package inlines remend-utils (MIT).', 'remend'), false);
  assert.equal(mentionsPackage('This package inlines remend (MIT).', 'remend'), true);
  // A full stop ends a sentence, so it must not hide the name before it.
  assert.equal(mentionsPackage('This package inlines remend.', 'remend'), true);
});

test('a dotted or plussed name matches itself and nothing longer', () => {
  assert.equal(mentionsPackage('bundles lodash.merge (MIT)', 'lodash.merge'), true);
  assert.equal(mentionsPackage('bundles lodash.mergeWith (MIT)', 'lodash.merge'), false);
  assert.equal(mentionsPackage('bundles lodashXmerge (MIT)', 'lodash.merge'), false);
  assert.equal(mentionsPackage('bundles foo+bar (MIT)', 'foo+bar'), true);
  assert.equal(mentionsPackage('bundles foo+barbecue (MIT)', 'foo+bar'), false);
});

test('a scoped name matches only itself', () => {
  assert.equal(mentionsPackage('bundles @scope/name (MIT)', '@scope/name'), true);
  assert.equal(mentionsPackage('bundles @scope/name-extra (MIT)', '@scope/name'), false);
  assert.equal(mentionsPackage('bundles @other/name (MIT)', '@scope/name'), false);
  // An unscoped name is not declared by a scoped package that ends with it.
  assert.equal(mentionsPackage('bundles @scope/remend (MIT)', 'remend'), false);
});

test('a version or a subpath still names the same package', () => {
  assert.equal(mentionsPackage('bundles remend@1.2.3 (MIT)', 'remend'), true);
  assert.equal(mentionsPackage('inlines remend/dist/index.js', 'remend'), true);
});

test('a neighbour with a longer name is not read as a denial either', () => {
  assert.equal(deniesBundling('remend-utils is not bundled, it stays external.', 'remend'), false);
  assert.equal(deniesBundling('remend is not bundled, it stays external.', 'remend'), true);
});

test('a name with regex characters is not treated as a pattern', () => {
  // Unescaped, `lodash.merge` would also match "lodashXmerge" and a `+` or `*`
  // in a name would throw outright.
  assert.equal(deniesBundling('lodashXmerge is not bundled.', 'lodash.merge'), false);
  assert.equal(escapeForRegExp('@scope/name+1.0'), '@scope/name\\+1\\.0');
});

/* ---------------------------------------------------------------------------
   Deciding what license text the notice owes.
--------------------------------------------------------------------------- */

test('MIT demands the permission sentence', () => {
  const demands = licenseDemands('MIT');
  assert.equal(demands.kind, 'text');
  assert.deepEqual(demands.markers, [MIT_SENTENCE]);
});

test('Apache-2.0 demands the full text, not just a credit', () => {
  const demands = licenseDemands('Apache-2.0');
  assert.equal(demands.kind, 'text');
  assert.match(demands.markers[0], /TERMS AND CONDITIONS/);
});

test('ISC and BSD demand their own sentences', () => {
  assert.match(licenseDemands('ISC').markers[0], /Permission to use, copy, modify, and\/or distribute/);
  assert.match(licenseDemands('BSD-3-Clause').markers[0], /Redistribution and use/);
  assert.match(licenseDemands('BSD-2-Clause').markers[0], /Redistribution and use/);
});

test('a public-domain-equivalent license demands no text', () => {
  assert.equal(licenseDemands('0BSD').kind, 'none');
  assert.equal(licenseDemands('CC0-1.0').kind, 'none');
});

test('a dual license is satisfied by either side, since the distributor picks', () => {
  const demands = licenseDemands('(MIT OR Apache-2.0)');
  assert.equal(demands.kind, 'text');
  assert.equal(demands.markers.length, 2);
});

test('copyleft is a decision for a person, not a paragraph to paste', () => {
  for (const license of ['GPL-3.0', 'AGPL-3.0-only', 'LGPL-2.1', 'MPL-2.0', 'SSPL-1.0']) {
    assert.equal(licenseDemands(license).kind, 'review', `${license} must stop the build`);
  }
});

test('a dual license with one permissive side is allowed on the permissive side', () => {
  const demands = licenseDemands('(GPL-3.0 OR MIT)');
  assert.equal(demands.kind, 'text');
  assert.deepEqual(demands.markers, [MIT_SENTENCE]);
});

test('a license this check does not know stops the build rather than passing', () => {
  assert.equal(licenseDemands('').kind, 'unknown');
  assert.equal(licenseDemands(undefined).kind, 'unknown');
  assert.equal(licenseDemands('Beerware').kind, 'unknown');
  // Two licenses at once is rare enough that guessing is worse than stopping.
  assert.equal(licenseDemands('MIT AND CC-BY-4.0').kind, 'unknown');
});

/* ---------------------------------------------------------------------------
   The bundled audit as a whole.
--------------------------------------------------------------------------- */

/** A package that does everything right, as the baseline to break. */
function compliant(overrides = {}) {
  return {
    notice: `# Third-party licenses

## Bundled dependencies

This package inlines remend (MIT) into its dist.

${MIT_SENTENCE}, to any person obtaining a copy...
`,
    files: ['dist', 'THIRD-PARTY-LICENSES.md'],
    bundled: new Set(['remend']),
    licenseOf: () => 'MIT',
    ...overrides,
  };
}

test('a package that declares its bundling properly has nothing wrong with it', () => {
  assert.deepEqual(auditBundled('packages/example', compliant()), []);
});

test('bundling with no notice at all fails, and names the dependency', () => {
  const [failure] = auditBundled('packages/example', compliant({ notice: null }));
  assert.match(failure, /packages\/example/);
  assert.match(failure, /remend/);
  assert.match(failure, /no THIRD-PARTY-LICENSES\.md/);
});

test('a notice missing from the "files" array fails, because npm pack drops it', () => {
  // The @domternal/core 0.15.0 shape: notice in the repository, not in the
  // tarball.
  const failures = auditBundled('packages/example', compliant({ files: ['dist'] }));
  assert.ok(failures.some((failure) => failure.includes('"files" array')));
});

test('a bundled dependency the notice never mentions fails', () => {
  const failures = auditBundled(
    'packages/example',
    compliant({ notice: `# Third-party licenses\n\n${MIT_SENTENCE}...\n` })
  );
  assert.ok(failures.some((failure) => /not declared under a heading that says bundled/.test(failure)));
});

test('a dependency mentioned only outside a bundled section fails', () => {
  const notice = `# Third-party licenses

## Not bundled

remend ships as its own package.

${MIT_SENTENCE}...
`;
  const failures = auditBundled('packages/example', compliant({ notice }));
  assert.ok(failures.some((failure) => /not declared under a heading/.test(failure)));
  assert.ok(failures.some((failure) => /claims "remend" is not bundled/.test(failure)));
});

test('a notice that declares AND denies the same dependency still fails', () => {
  // The near miss this half was ported for: the notice named the dependency,
  // so a presence check passed, while the sentence next to it said the
  // opposite of what tsup does.
  const notice = `# Third-party licenses

## Bundled dependencies

remend is not bundled into this package.

${MIT_SENTENCE}...
`;
  const failures = auditBundled('packages/example', compliant({ notice }));
  assert.ok(failures.some((failure) => /claims "remend" is not bundled while tsup inlines it/.test(failure)));
});

test('a neighbouring package with a longer name declares nothing on its behalf', () => {
  // The review's whole notice: remend is what tsup inlines, the notice declares
  // remend-utils under a bundled heading, and the MIT sentence beside it is the
  // neighbour's. A substring test passes this and remend ships with no license
  // of its own anywhere in the tarball.
  const notice = `# Third-party licenses

## Bundled dependencies

This package inlines remend-utils (MIT) into its dist.

${MIT_SENTENCE}, to any person obtaining a copy...
`;
  const failures = auditBundled('packages/example', compliant({ notice }));
  assert.ok(
    failures.some((failure) => /bundled dependency "remend" is not declared/.test(failure)),
    'remend must still be demanded, its neighbour is a different package'
  );
});

test('an Apache dependency with only the MIT sentence fails', () => {
  const failures = auditBundled('packages/example', compliant({ licenseOf: () => 'Apache-2.0' }));
  assert.ok(failures.some((failure) => /lacks the full Apache 2\.0 text/.test(failure)));
});

test('a dependency whose license cannot be read fails rather than being skipped', () => {
  // Skipping would make an uninstalled dependency the easiest way to get a
  // bundled package past every license check below.
  const failures = auditBundled('packages/example', compliant({ licenseOf: () => null }));
  assert.ok(failures.some((failure) => /could not read the license/.test(failure)));
});

test('a copyleft dependency fails even with a perfect notice', () => {
  const failures = auditBundled('packages/example', compliant({ licenseOf: () => 'GPL-3.0-only' }));
  assert.ok(failures.some((failure) => /licensing decision rather than a notice/.test(failure)));
});

/* ---------------------------------------------------------------------------
   The hand-written half stays honest about this repository.
--------------------------------------------------------------------------- */

test('every REQUIRED entry names a source file that exists', () => {
  for (const entry of REQUIRED) {
    const path = join(repoRoot, entry.package, entry.source);
    assert.ok(existsSync(path), `${entry.package}: ${entry.source} is gone, so the entry guards nothing`);
  }
});

test('every REQUIRED entry is complete', () => {
  for (const entry of REQUIRED) {
    assert.ok(entry.package.startsWith('packages/'), 'package must be a repo-relative path');
    assert.ok(entry.source.length > 0, `${entry.package} must name the file that embeds the material`);
    assert.ok(entry.markers.length > 0, `${entry.package} must name the text its notice has to carry`);
    assert.ok(entry.reason.length > 0, `${entry.package} must say why it needs a notice`);
  }
});

test('the tsup config names cover the extension tsup actually loads', () => {
  assert.ok(TSUP_CONFIGS.includes('tsup.config.ts'));
  for (const suffix of ['.mts', '.cts', '.js', '.mjs', '.cjs']) {
    assert.ok(
      TSUP_CONFIGS.some((name) => name.endsWith(suffix)),
      `a rename to tsup.config${suffix} must not end the discovery`
    );
  }
});
