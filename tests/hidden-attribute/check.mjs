#!/usr/bin/env node
/**
 * Fails when the theme could take the `hidden` attribute away again.
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
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/** The compiled theme, expanded so selectors are readable in a failure. */
export const THEME_CSS = 'packages/theme/dist/domternal-theme.expanded.css';

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

/** Every `selector { body }` pair in a stylesheet, at-rule bodies included. */
export function parseRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
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

function main() {
  const cssPath = join(repoRoot, THEME_CSS);
  if (!existsSync(cssPath)) {
    console.error(`[hidden-attribute] FAILED: no compiled theme at ${THEME_CSS}`);
    console.error('[hidden-attribute] Run `pnpm --filter @domternal/theme build` first.');
    process.exit(1);
  }
  const css = readFileSync(cssPath, 'utf8');

  const problems = checkHiddenRule(css);
  for (const { selector, display } of findUnscopedDisplays(css)) {
    problems.push(
      `${selector} sets display: ${display} outside the dm- scope, so [hidden] would not survive on it`
    );
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

  const displays = parseRules(css).filter((rule) => {
    const display = displayOf(rule.body);
    return display && display !== 'none';
  }).length;
  console.log(
    `[hidden-attribute] OK - the attribute is restored, and all ${displays} display rules sit inside its scope`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
