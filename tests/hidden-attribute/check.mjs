#!/usr/bin/env node
/**
 * Fails when a stylesheet in this repository could take the `hidden` attribute
 * away again.
 *
 * `[hidden] { display: none }` lives in the user agent stylesheet, and author
 * styles beat the user agent stylesheet whatever their specificity. So every
 * `display` declaration in this theme is a chance to disable the attribute for
 * that element, silently: `.dm-toolbar` set `display: flex`, and a consumer who
 * wrote `toolbar.hidden = true` got an empty strip, background, border and
 * padding intact, with nothing in the console to explain it.
 *
 * One scoped rule in `_hidden.scss` restores the attribute for everything this
 * theme styles. This gate holds two halves of that down:
 *
 * 1. the rule is still there, still `!important`, and still excludes
 *    `hidden="until-found"`, which does NOT mean `display: none`;
 * 2. every `display` the theme sets is inside the scope that rule covers, so a
 *    new component cannot reintroduce the defect by being written outside it.
 *
 * The compiled CSS is read rather than the SCSS sources, because nesting means
 * a source selector says nothing about the selector that ships. What matters is
 * what a browser is handed.
 *
 * ## The same file runs in both repositories
 *
 * In the free repo it checks the theme it owns. In the Pro repo it checks the
 * six stylesheets the Pro packages ship, against the theme they are installed
 * beside: the restoring rule lives in `@domternal/theme`, which every Pro
 * package declares as a peer, so a Pro surface is covered only while two things
 * hold. Both are checked here rather than assumed:
 *
 *   - the installed theme really does carry the rule, and
 *   - every Pro selector stays inside the scope that rule covers, which in
 *     practice means every Pro element keeps its `dm-` prefix.
 *
 * Today that is true of all of them. It is true by convention, and convention
 * is what this gate replaces.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/**
 * Where the theme carrying the restoring rule can be, in order of preference.
 *
 * The workspace copy first, because that is the one being edited where it
 * exists. Otherwise the installed one, reached through any workspace member,
 * which is how the Pro repo sees it.
 */
export const THEME_CANDIDATES = [
  'packages/theme/dist/domternal-theme.expanded.css',
  'packages/theme/dist/domternal-theme.css',
  'node_modules/@domternal/theme/dist/domternal-theme.css',
];

/** Workspace directories whose members may each install or ship stylesheets. */
export const WORKSPACE_DIRS = ['packages', 'apps'];

/**
 * Selectors allowed to set `display` without naming a `dm-` class.
 *
 * Only for elements that cannot exist outside the editor, where the rule's
 * descendant half covers them anyway. Every entry needs that argument, because
 * a selector added here without one is the defect coming back.
 */
export const OUTSIDE_SCOPE_ALLOWED = [
  // ProseMirror's own separator image, rendered by the view inside
  // `.dm-editor .ProseMirror` and nowhere else.
  'img.ProseMirror-separator',
];

/**
 * Drops comments before anything is parsed.
 *
 * Load-bearing rather than tidiness. A comment sits between the previous rule's
 * closing brace and the next selector, so an un-stripped one becomes part of
 * that selector: the whole paragraph reads as a selector that names no `dm-`
 * class, and every commented rule is reported as escaping the scope. The
 * theme's own output hid this, because Sass strips its `//` comments; the Pro
 * stylesheets are hand-written CSS and kept theirs.
 */
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every `selector { body }` pair in a stylesheet, at-rule bodies included. */
export function parseRules(css) {
  return [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({ selector: match[1].trim().replace(/\s+/g, ' '), body: match[2] }))
    .filter((rule) => rule.selector && !rule.selector.startsWith('@'));
}

/** The `display` a rule sets, or null when it sets none. */
export function displayOf(body) {
  const match = /(^|[;\s])display\s*:\s*([a-z-]+)/.exec(body);
  return match ? match[2] : null;
}

/** True when a selector confines itself to elements this theme owns. */
export function isScoped(selector) {
  return selector.split(',').every((part) => /\.dm-|\[class[\^*~|$]?=/.test(part));
}

/**
 * Every rule that gives an element a `display` the `hidden` rule would have to
 * beat, while sitting outside the scope that rule covers.
 */
export function findUnscopedDisplays(css, allowed = OUTSIDE_SCOPE_ALLOWED) {
  const problems = [];
  for (const { selector, body } of parseRules(css)) {
    const display = displayOf(body);
    if (!display || display === 'none') continue;
    if (isScoped(selector)) continue;
    if (allowed.includes(selector)) continue;
    problems.push({ selector, display });
  }
  return problems;
}

/** What the restoring rule must still say. Each entry is a failure on its own. */
export function checkHiddenRule(css) {
  const problems = [];
  const rules = parseRules(css).filter(
    (rule) => rule.selector.includes('[hidden]') && displayOf(rule.body) === 'none'
  );

  if (rules.length === 0) {
    problems.push('no rule restores [hidden] at all; _hidden.scss is missing or not imported');
    return problems;
  }

  const all = rules.map((rule) => `${rule.selector}{${rule.body}}`).join('\n');
  if (!/display\s*:\s*none\s*!important/.test(all)) {
    problems.push(
      'the [hidden] rule is not !important, so any longer selector takes the attribute away again'
    );
  }
  if (!/until-found/.test(all)) {
    problems.push(
      'the [hidden] rule does not exclude hidden="until-found", which is not display: none and cannot be recovered from an !important rule'
    );
  }
  // Both halves: the element itself, and anything hidden inside one of ours.
  const selectors = rules.map((rule) => rule.selector).join(' ');
  if (!/\[class[\^*]='?dm-'?\]\[hidden\]|\[class[\^*]=dm-\]\[hidden\]|\[class[\^*]=" dm-"\]\[hidden\]/.test(selectors)) {
    problems.push('the [hidden] rule does not cover an element carrying a dm- class');
  }
  if (!/\]\s+\[hidden\]/.test(selectors)) {
    problems.push('the [hidden] rule does not cover an element hidden INSIDE one of ours');
  }
  return problems;
}

/**
 * The theme carrying the restoring rule, wherever this repository keeps it.
 *
 * Looked for beside every workspace member as well as at the root, because
 * pnpm links a peer next to the package that declared it rather than hoisting
 * it, so in the Pro repo there is no copy at the root at all.
 */
export function findTheme(root, candidates = THEME_CANDIDATES, dirs = WORKSPACE_DIRS) {
  const paths = candidates.map((rel) => join(root, rel));
  for (const dir of dirs) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    for (const member of readdirSync(base)) {
      for (const rel of candidates) {
        // Only the installed forms make sense beside a member.
        if (!rel.startsWith('node_modules/')) continue;
        paths.push(join(base, member, rel));
      }
    }
  }
  return paths.find((path) => existsSync(path)) ?? null;
}

/**
 * Every compiled stylesheet this repository SHIPS, which is the set that could
 * take the attribute away from a consumer.
 *
 * Discovered rather than listed: a new package with a stylesheet is covered the
 * day it exists, which is the whole point of a gate that guards a convention.
 * A minified file is skipped where its expanded twin is present, so a failure
 * is reported once and with a selector a person can read.
 */
export function discoverStylesheets(root, dirs = WORKSPACE_DIRS) {
  const found = [];
  for (const dir of dirs) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    for (const member of readdirSync(base).sort()) {
      const dist = join(base, member, 'dist');
      if (!existsSync(dist)) continue;
      const files = readdirSync(dist).filter((name) => name.endsWith('.css'));
      for (const name of files) {
        const expanded = name.replace(/\.css$/, '.expanded.css');
        if (!name.endsWith('.expanded.css') && files.includes(expanded)) continue;
        found.push(join(dist, name));
      }
    }
  }
  return found;
}

function main() {
  const themePath = findTheme(repoRoot);
  if (!themePath) {
    console.error('[hidden-attribute] FAILED: no compiled @domternal/theme to check');
    console.error('[hidden-attribute] Build it (`pnpm --filter @domternal/theme build`) or');
    console.error('[hidden-attribute] install it, then run again.');
    process.exit(1);
  }

  /* The rule itself, in whichever theme this repository is built against. Pro
     stylesheets carry no rule of their own and are not supposed to: they rely
     on the theme they declare as a peer, so checking it here is checking the
     thing they actually depend on. */
  const problems = checkHiddenRule(readFileSync(themePath, 'utf8'));

  const stylesheets = discoverStylesheets(repoRoot);
  for (const path of stylesheets) {
    const css = readFileSync(path, 'utf8');
    const where = relative(repoRoot, path);
    for (const { selector, display } of findUnscopedDisplays(css)) {
      problems.push(
        `${where}: ${selector} sets display: ${display} outside the dm- scope, so [hidden] would not survive on it`
      );
    }
  }

  if (problems.length > 0) {
    console.error('[hidden-attribute] FAILED:');
    console.error('');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('');
    console.error('[hidden-attribute] A consumer who hides one of our elements with the');
    console.error('[hidden-attribute] attribute gets an empty box with our background and');
    console.error('[hidden-attribute] border, and nothing in the console. See _hidden.scss.');
    process.exit(1);
  }

  const displays = stylesheets.reduce((total, path) => {
    const rules = parseRules(readFileSync(path, 'utf8'));
    return (
      total +
      rules.filter((rule) => {
        const display = displayOf(rule.body);
        return display && display !== 'none';
      }).length
    );
  }, 0);
  console.log(
    `[hidden-attribute] OK - the attribute is restored in ${relative(repoRoot, themePath)}, ` +
      `and all ${displays} display rules across ${stylesheets.length} stylesheet(s) sit inside its scope`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
