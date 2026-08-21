/**
 * Fixture tests for the hidden-attribute gate.
 *
 * The defect it guards is invisible by nature: an element that should be gone
 * is merely empty, with our background and border, and nothing is logged. So
 * the gate's own reading of the stylesheet has to be right, including on the
 * shapes that are easy to get wrong, a selector list where only one part is
 * scoped, an at-rule body, and the one attribute value that must survive.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OUTSIDE_SCOPE_ALLOWED,
  THEME_CANDIDATES,
  WORKSPACE_DIRS,
  checkHiddenRule,
  discoverStylesheets,
  displayOf,
  findTheme,
  findUnscopedDisplays,
  isScoped,
  parseRules,
  stripComments,
} from './check.mjs';

/** The rule the theme actually ships, as the gate must see it. */
const REAL_RULE = `
[class^=dm-][hidden]:not([hidden=until-found i]),
[class*=" dm-"][hidden]:not([hidden=until-found i]),
[class^=dm-] [hidden]:not([hidden=until-found i]),
[class*=" dm-"] [hidden]:not([hidden=until-found i]) {
  display: none !important;
}
`;

test('rules are read out of a stylesheet, at-rules skipped', () => {
  const css = '.a { display: flex; }\n@media (min-width: 1px) { .b { color: red; } }';
  const selectors = parseRules(css).map((rule) => rule.selector);
  assert.ok(selectors.includes('.a'));
  assert.ok(!selectors.some((selector) => selector.startsWith('@')));
});

test('the display a rule sets is read, and only that property', () => {
  assert.equal(displayOf('display: flex;'), 'flex');
  assert.equal(displayOf('color: red; display: grid;'), 'grid');
  assert.equal(displayOf('color: red;'), null);
  // Not a `display` at all, and a substring match would say otherwise.
  assert.equal(displayOf('--dm-display-hack: flex;'), null);
});

test('a selector is scoped when every part of it is', () => {
  assert.equal(isScoped('.dm-toolbar'), true);
  assert.equal(isScoped('.dm-editor .ProseMirror img'), true);
  assert.equal(isScoped('[class^=dm-][hidden]'), true);
  assert.equal(isScoped('.consumer-widget'), false);
  /* A list where one part escapes the scope is not scoped: the rule applies to
     every part, so the weakest one decides. */
  assert.equal(isScoped('.dm-toolbar, .consumer-widget'), false);
});

test('an unscoped display rule is reported', () => {
  const problems = findUnscopedDisplays('.consumer-widget { display: flex; }', []);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].selector, '.consumer-widget');
  assert.equal(problems[0].display, 'flex');
});

test('display: none outside the scope is not a problem', () => {
  // It cannot take the attribute away; it does the same thing the attribute does.
  assert.deepEqual(findUnscopedDisplays('.whatever { display: none; }', []), []);
});

test('an allowlisted selector is accepted, and the list is not empty by accident', () => {
  assert.deepEqual(
    findUnscopedDisplays('img.ProseMirror-separator { display: inline; }'),
    []
  );
  /* One entry today, ProseMirror's own separator, which the view renders inside
     `.dm-editor .ProseMirror` and nowhere else, so the rule's descendant half
     covers it. */
  assert.ok(OUTSIDE_SCOPE_ALLOWED.includes('img.ProseMirror-separator'));
});

test('the real rule passes every half of the check', () => {
  assert.deepEqual(checkHiddenRule(REAL_RULE), []);
});

test('a missing rule is the loudest failure', () => {
  const problems = checkHiddenRule('.dm-toolbar { display: flex; }');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no rule restores \[hidden\]/);
});

test('dropping !important is caught', () => {
  /* Without it the next component rule with a longer selector takes the
     attribute away again, and silently, which is how this defect survived in
     the first place. */
  const problems = checkHiddenRule(REAL_RULE.replace(' !important', ''));
  assert.ok(problems.some((problem) => problem.includes('not !important')));
});

test('dropping the until-found exclusion is caught', () => {
  /* `hidden="until-found"` does not mean `display: none`: the element stays
     findable and the browser reveals it. An !important rule that forced it
     would leave no way back. */
  const problems = checkHiddenRule(REAL_RULE.replaceAll(':not([hidden=until-found i])', ''));
  assert.ok(problems.some((problem) => problem.includes('until-found')));
});

test('covering only our own elements, and not what is inside them, is caught', () => {
  /* Node views and popovers hide their own parts, and none of those parts
     carries a `dm-` class. */
  const onlySelf = `
[class^=dm-][hidden]:not([hidden=until-found i]) { display: none !important; }
`;
  const problems = checkHiddenRule(onlySelf);
  assert.ok(problems.some((problem) => problem.includes('INSIDE')));
});

test('covering only descendants, and not our elements themselves, is caught', () => {
  // The reported bug was the toolbar itself, not something inside it.
  const onlyInside = `
[class^=dm-] [hidden]:not([hidden=until-found i]) { display: none !important; }
`;
  const problems = checkHiddenRule(onlyInside);
  assert.ok(problems.some((problem) => problem.includes('carrying a dm- class')));
});

test('a comment before a selector does not become part of it', () => {
  /* The failure mirroring into the Pro repo exposed. A comment sits between one
     rule's closing brace and the next selector, so an un-stripped one reads as a
     selector naming no `dm-` class, and every commented rule is reported as
     escaping the scope. Sass strips the theme's `//` comments, which is why the
     theme alone never showed it; the Pro stylesheets are hand-written CSS. */
  const css = '/* Docked at the frame edge. */ .dm-panel { display: flex; }';
  assert.deepEqual(findUnscopedDisplays(css, []), []);
  assert.equal(parseRules(css)[0].selector, '.dm-panel');
});

test('stripComments leaves the rules themselves alone', () => {
  assert.equal(stripComments('.a { display: flex; }'), '.a { display: flex; }');
  assert.equal(stripComments('/* x */.a{}').trim(), '.a{}');
});

test('a multi-line comment between rules is stripped', () => {
  const css = ['.dm-a { display: flex; }', '/* one', '   two */', '.dm-b { display: grid; }'].join('\n');
  assert.deepEqual(findUnscopedDisplays(css, []), []);
});

test('the theme is looked for beside a workspace member, not only at the root', () => {
  /* pnpm links a peer next to the package that declared it rather than hoisting
     it, so in the Pro repo there is no copy at the root at all and a root-only
     search would report the theme missing. */
  const root = mkdtempSync(join(tmpdir(), 'hidden-theme-'));
  try {
    const nested = join(root, 'apps', 'playground', 'node_modules', '@domternal', 'theme', 'dist');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'domternal-theme.css'), '[hidden] { display: none !important }');
    assert.equal(findTheme(root), join(nested, 'domternal-theme.css'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing theme is reported as absent rather than guessed at', () => {
  const root = mkdtempSync(join(tmpdir(), 'hidden-theme-'));
  try {
    assert.equal(findTheme(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every shipped stylesheet is discovered, expanded twins preferred', () => {
  /* Discovery rather than a list, so a new package's stylesheet is covered the
     day it exists. The minified twin is skipped so a failure is reported once,
     with a selector a person can read. */
  const root = mkdtempSync(join(tmpdir(), 'hidden-sheets-'));
  try {
    const dist = join(root, 'packages', 'theme', 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'domternal-theme.css'), '');
    writeFileSync(join(dist, 'domternal-theme.expanded.css'), '');
    const other = join(root, 'packages', 'extension-comments', 'dist');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'comments.css'), '');

    const found = discoverStylesheets(root).map((path) => path.replace(root, ''));
    assert.equal(found.length, 2);
    assert.ok(found.some((path) => path.endsWith('domternal-theme.expanded.css')));
    assert.ok(found.some((path) => path.endsWith('comments.css')));
    assert.ok(!found.some((path) => path.endsWith('/domternal-theme.css')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('both workspace directories are searched', () => {
  // Packages ship the stylesheets; apps are where a peer gets linked.
  assert.ok(WORKSPACE_DIRS.includes('packages'));
  assert.ok(WORKSPACE_DIRS.includes('apps'));
  assert.ok(THEME_CANDIDATES.some((path) => path.startsWith('node_modules/')));
});

test('a Pro-shaped selector keeps the prefix the rule keys on', () => {
  /* The convention this gate replaces: every Pro element carries `dm-`, so the
     theme's rule reaches it. A Pro package that invented its own prefix would
     be invisible to the rule and is caught here. */
  assert.equal(isScoped('.dm-panel-header'), true);
  assert.equal(isScoped('.dm-editor-pill-clip'), true);
  assert.equal(isScoped('.dmp-panel'), false);
});
