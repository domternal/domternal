/**
 * Fixture tests for the CSS variable gate.
 *
 * The gate is the only thing in the build that reads a custom property name at
 * all, so a hole in it is not caught by anything downstream: the reference just
 * stops being checked and nobody learns that it stopped. These fixtures pin the
 * two halves that can silently go quiet, which files get opened and which
 * spellings count as a definition.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit, collect, isScanned, packageSourceDirs, withoutComments } from './check.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('a fallback-less reference is collected with the file that first named it', () => {
  const { refs, missing } = audit([
    { path: 'packages/theme/src/_x.scss', text: 'a { color: var(--dm-text); }' },
  ]);
  assert.equal(refs.get('--dm-text'), 'packages/theme/src/_x.scss');
  assert.deepEqual(missing, ['--dm-text']);
});

test('a reference carrying a fallback is not judged', () => {
  /* The documented way to depend softly on a value this repository does not
     own. Flagging it would make the escape hatch useless. */
  const { refs, missing } = audit([
    { path: 'packages/theme/src/_x.scss', text: 'a { color: var(--dm-text, #000); }' },
  ]);
  assert.equal(refs.size, 0);
  assert.deepEqual(missing, []);
});

test('a definition in one package answers a reference in another', () => {
  const { missing } = audit([
    { path: 'packages/extension-toc/src/toc.scss', text: 'nav { top: var(--dm-toc-top); }' },
    { path: 'packages/theme/src/_variables.scss', text: ':root { --dm-toc-top: 50vh; }' },
  ]);
  assert.deepEqual(missing, []);
});

test('a stylesheet outside packages/theme is scanned like any other', () => {
  /* Latent today, since every stylesheet still lives in the theme package.
     This is the case that must work on the day the first one does not. */
  const { refs } = audit([
    { path: 'packages/extension-table/src/table.css', text: '.t { color: var(--dm-oops); }' },
  ]);
  assert.equal(refs.get('--dm-oops'), 'packages/extension-table/src/table.css');
});

test('setProperty in TypeScript defines a variable', () => {
  // The shape used by FloatingTocOutline.ts and by both toolbars.
  const { missing } = audit([
    { path: 'packages/theme/src/_toc.scss', text: 'nav { top: var(--dm-toc-mid-top); }' },
    {
      path: 'packages/extension-toc/src/FloatingTocOutline.ts',
      text: "nav.style.setProperty('--dm-toc-mid-top', `calc(50vh - ${half}px)`);",
    },
  ]);
  assert.deepEqual(missing, []);
});

test('a style string built in TypeScript defines a variable too', () => {
  /* toolbar.component.ts returns `--dm-palette-columns: N` for an Angular
     [style] binding, which setProperty alone would never see. */
  const { missing } = audit([
    { path: 'packages/theme/src/_color-palette.scss', text: 'grid: var(--dm-palette-columns);' },
    {
      path: 'packages/angular/src/lib/toolbar.component.ts',
      text: 'return `--dm-palette-columns: ${String(columns)}`;',
    },
  ]);
  assert.deepEqual(missing, []);
});

test('a reference written in TypeScript is seen, doc comments included', () => {
  /* The three wrapper files document their color value by naming one variable,
     and that literal is the only fixed spelling of the family in TypeScript.
     Stripping comments would take the one checkable name away. */
  const { refs, missing } = audit([
    {
      path: 'packages/react/src/bubble-menu/useBubbleMenu.ts',
      text: '/** CSS color value (e.g. `var(--dm-block-text-yellow)`), or null. */',
    },
  ]);
  assert.equal(
    refs.get('--dm-block-text-yellow'),
    'packages/react/src/bubble-menu/useBubbleMenu.ts'
  );
  assert.deepEqual(missing, ['--dm-block-text-yellow']);
});

test('a name assembled at runtime has nothing to check and is skipped', () => {
  const { refs, missing } = audit([
    {
      path: 'packages/vanilla/src/bubble-menu/trailingState.ts',
      text: 'textVar = tToken ? `var(--dm-block-text-${tToken})` : null;',
    },
  ]);
  assert.equal(refs.size, 0);
  assert.deepEqual(missing, []);
});

test('test files contribute neither references nor definitions', () => {
  /* A spec names variables that do not exist on purpose, and a property set
     for one assertion is not a property anything ships. */
  const spec = collect(
    'packages/extension-toc/src/FloatingTocOutline.test.ts',
    "el.style.setProperty('--dm-only-here', 'x'); expect('var(--dm-invented)');"
  );
  assert.deepEqual(spec, { refs: [], defs: [] });
  assert.equal(isScanned('packages/core/src/a.test.tsx'), false);
  assert.equal(isScanned('packages/core/src/a.ts'), true);
  assert.equal(isScanned('packages/theme/src/_a.scss'), true);
  assert.equal(isScanned('packages/theme/src/logo.svg'), false);
});

test('missing names are reported sorted, each with its first reference', () => {
  const { missing, refs } = audit([
    { path: 'packages/theme/src/b.scss', text: 'var(--dm-zeta) var(--dm-alpha)' },
    { path: 'packages/theme/src/a.scss', text: 'var(--dm-alpha)' },
  ]);
  assert.deepEqual(missing, ['--dm-alpha', '--dm-zeta']);
  assert.equal(refs.get('--dm-alpha'), 'packages/theme/src/b.scss');
});

test('the scan really covers every package, not just the theme', () => {
  /* The regression this port exists to prevent: narrowing the walk back to one
     package would leave every other stylesheet unguarded and still pass. */
  const dirs = packageSourceDirs(repoRoot).map((path) => path.slice(repoRoot.length + 1));
  assert.ok(dirs.includes('packages/theme/src'), 'theme is still scanned');
  assert.ok(dirs.length > 1, `expected more than one package source directory, got ${dirs.length}`);
});

test('a definition that lives only in a comment does not answer a reference', () => {
  /* The exact input that defeated the raw-text scan: delete the declaration,
     leave the changelog note where it stood, and every reference to the
     variable stayed green while the browser resolved it to unset. */
  const { missing } = audit([
    { path: 'packages/theme/src/_x.scss', text: 'a { color: var(--dm-ghost); }' },
    {
      path: 'packages/core/src/history.ts',
      text: '// historical: --dm-ghost: #fff was removed in 0.9\nexport const x = 1;',
    },
  ]);
  assert.deepEqual(missing, ['--dm-ghost']);
});

test('a commented-out declaration in a stylesheet does not define either', () => {
  /* Block comments are how a stylesheet parks a value it is not ready to
     delete, and Sass line comments are how it annotates one. */
  const { missing } = audit([
    { path: 'packages/theme/src/_a.scss', text: 'a { color: var(--dm-ghost); }' },
    {
      path: 'packages/theme/src/_variables.scss',
      text: ':root {\n  /* --dm-ghost: #fff; */\n  // --dm-ghost: #eee;\n}',
    },
  ]);
  assert.deepEqual(missing, ['--dm-ghost']);
});

test('a commented-out setProperty call does not define', () => {
  const { missing } = audit([
    { path: 'packages/theme/src/_toc.scss', text: 'nav { top: var(--dm-toc-mid-top); }' },
    {
      path: 'packages/extension-toc/src/FloatingTocOutline.ts',
      text: "// nav.style.setProperty('--dm-toc-mid-top', top);",
    },
  ]);
  assert.deepEqual(missing, ['--dm-toc-mid-top']);
});

test('a comment still supplies a reference, in the same file that cannot define', () => {
  /* The two halves are deliberately asymmetric: the doc comments in the three
     wrapper files are the only checkable spelling of that variable family, so
     stripping references too would take the check away. */
  const { refs, missing } = audit([
    {
      path: 'packages/react/src/bubble-menu/useBubbleMenu.ts',
      text: '/** e.g. `var(--dm-block-text-yellow)`, and --dm-block-text-yellow: gold used to live here. */',
    },
  ]);
  assert.equal(refs.get('--dm-block-text-yellow'), 'packages/react/src/bubble-menu/useBubbleMenu.ts');
  assert.deepEqual(missing, ['--dm-block-text-yellow']);
});

test('a slash pair inside a string is not a comment, so what follows still defines', () => {
  /* A URL in a style string is the everyday case. Treating it as a comment
     would drop a real definition and fail for a reason that is not true. */
  const { missing } = audit([
    { path: 'packages/theme/src/_a.scss', text: 'a { color: var(--dm-brand); }' },
    {
      path: 'packages/vanilla/src/toolbar.ts',
      text: 'el.setAttribute("style", "background: url(https://x/y.png); --dm-brand: red");',
    },
  ]);
  assert.deepEqual(missing, []);
  assert.match(withoutComments('a.ts', 'const u = "https://x"; // gone'), /^const u = "https:\/\/x"; $/);
});

test('a .sass file is a stylesheet here, as it is to the package policy gate', () => {
  /* tests/package-policy/check.mjs counts .sass when it looks for side-effect
     imports. A stylesheet that only one of the two gates can see is a
     stylesheet that half the build is not guarding. */
  assert.equal(isScanned('packages/theme/src/_a.sass'), true);
  const { refs, missing } = audit([
    { path: 'packages/theme/src/legacy.sass', text: 'a\n  color: var(--dm-sass-only)' },
  ]);
  assert.equal(refs.get('--dm-sass-only'), 'packages/theme/src/legacy.sass');
  assert.deepEqual(missing, ['--dm-sass-only']);
  assert.deepEqual(collect('packages/theme/src/legacy.sass', '// --dm-sass-only: red').defs, []);
});

test('references and variables are counted separately, because they differ', () => {
  /* The success line names one of these numbers, and the two are about a
     factor of two apart across this repository. */
  const { refs, total } = audit([
    { path: 'packages/theme/src/a.scss', text: 'a { color: var(--dm-text); border-color: var(--dm-text); }' },
    { path: 'packages/theme/src/b.scss', text: 'b { color: var(--dm-text); background: var(--dm-bg); }' },
  ]);
  assert.equal(total, 4);
  assert.equal(refs.size, 2);
});
