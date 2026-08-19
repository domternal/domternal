#!/usr/bin/env node
/**
 * Fails when a `var(--dm-X)` reference carrying no fallback has no matching
 * `--dm-X` definition anywhere in this repository.
 *
 * A misspelled or half renamed custom property is invisible to everything else
 * in the build. TypeScript never sees it, Sass compiles it happily, and the
 * browser resolves it to `unset`, which for a color or a shadow usually means
 * the element quietly disappears into its background. Nothing reports it except
 * a person looking at the right pixel in the right theme.
 *
 * `var(--dm-X, fallback)` is left alone on purpose. A reference that carries a
 * fallback has already said what happens when the variable is absent, which is
 * how a stylesheet declares a soft dependency on a value it does not own.
 *
 * ## Why every package is scanned, not only the theme
 *
 * This changes nothing today, and claiming otherwise would oversell it: every
 * stylesheet in this repository still lives in `packages/theme/src`, so the
 * wide walk finds exactly the files the narrow one found. It is here for the
 * day an extension ships a stylesheet of its own, so that file is covered on
 * the day it lands rather than on the day somebody remembers this gate exists
 * and comes back to widen it. The Pro repository, where stylesheets are spread
 * across packages already, has scanned this way from the start.
 *
 * ## Why TypeScript is read as well
 *
 * A custom property does not have to be born in a stylesheet, and several here
 * are not:
 *
 * - `packages/extension-toc/src/FloatingTocOutline.ts` sets `--dm-toc-mid-top`
 *   and two siblings through `style.setProperty`,
 * - `packages/extension-table/src/TableView.ts` and the vanilla toolbar set
 *   `--dm-palette-columns` the same way,
 * - `packages/angular/src/lib/toolbar.component.ts` builds that same variable
 *   as the text `--dm-palette-columns: N` for a `[style]` binding.
 *
 * Read only stylesheets and every one of those is an undefined variable. All
 * four are referenced with a fallback today, so nothing was failing, but the
 * first fallback-less reference to one would have failed for a reason that was
 * not true, and a gate that cries wolf is a gate somebody switches off.
 *
 * References are read from TypeScript for the mirror of that reason. Three
 * files name `var(--dm-block-text-yellow)` in a doc comment, as the example of
 * what their color value looks like: `packages/react/src/bubble-menu/
 * useBubbleMenu.ts`, its Vue twin, and `packages/vanilla/src/bubble-menu/
 * trailingState.ts`. The variable is real, defined in `_variables.scss` and
 * overridden in both themes, so there is nothing wrong there now. A rename is
 * what this is for: those three examples are the only fixed spelling of that
 * variable family anywhere in TypeScript, because the code just below each one
 * assembles the name at runtime as `var(--dm-block-text-${token})`, which has
 * no name to check and never will.
 *
 * Comments are therefore read for references rather than stripped. A published
 * example naming a variable nobody defines is as wrong as a stylesheet naming
 * it, and nothing else in the build would ever say so. A comment that really
 * does mean a placeholder can carry a fallback like any other reference,
 * `var(--dm-your-color, red)`, and is then ignored here.
 *
 * ## Why a comment can nonetheless never define
 *
 * The definition half does not follow, and reading it from a comment switches
 * this gate off at the one moment it should fire. A note left where the code
 * used to be, `// historical: --dm-ghost: #fff was removed in 0.9`, matches the
 * definition pattern, so deleting the real declaration and leaving the
 * changelog line behind kept every `var(--dm-ghost)` reference green: nothing
 * defined it, the browser resolved it to unset, and the gate believed the
 * comment over the stylesheet. Definitions are therefore read from the code
 * with comments blanked out, while references keep being read from the file as
 * written.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/**
 * `var(--dm-X)` with nothing after the name. The comma form is the documented
 * way to say "not mine", so it is not a reference this gate has an opinion on.
 */
export const REF_NO_FALLBACK = /var\(\s*(--dm-[a-zA-Z0-9_-]+)\s*\)/g;

/** `--dm-X:`, whether it stands in a stylesheet or inside a style string. */
export const CSS_DEF = /(--dm-[a-zA-Z0-9_-]+)\s*:/g;

/** `element.style.setProperty('--dm-X', value)`. */
export const SET_PROPERTY_DEF = /setProperty\(\s*['"](--dm-[a-zA-Z0-9_-]+)['"]/g;

/**
 * Sass is listed because tests/package-policy/check.mjs counts `.sass` as a
 * stylesheet when it looks for side-effect imports, and two gates disagreeing
 * about what a stylesheet is means one of them is walking past files the other
 * one guards.
 */
export const STYLESHEET = /\.(scss|sass|css)$/;
export const SCRIPT = /\.[cm]?[jt]sx?$/;
export const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * The same text with every comment blanked out, newlines kept.
 *
 * Strings are tracked, so a `//` inside one, usually a URL, cannot swallow the
 * rest of its line, and a `--dm-X: value` assembled inside a template literal
 * still counts as the definition it is. `//` opens a comment in Sass and in
 * every script here, but not in plain CSS, whose only comment is the block
 * form.
 */
export function withoutComments(fileName, text) {
  const hasLineComments = !/\.css$/.test(fileName);
  let out = '';
  let index = 0;
  let quote = null;
  while (index < text.length) {
    const char = text[index];
    if (quote !== null) {
      out += char;
      if (char === '\\') {
        out += text[index + 1] ?? '';
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === '/' && text[index + 1] === '*') {
      const close = text.indexOf('*/', index + 2);
      const body = close === -1 ? text.slice(index) : text.slice(index, close + 2);
      // Blanked rather than removed, so line and column stay where they were.
      out += body.replace(/[^\n]/g, ' ');
      index += body.length;
      continue;
    }
    if (hasLineComments && char === '/' && text[index + 1] === '/') {
      const newline = text.indexOf('\n', index);
      index = newline === -1 ? text.length : newline;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/** Every capture of one global pattern, in source order. */
export function names(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

/** True for a file worth opening, so binaries and fixtures are never read. */
export function isScanned(fileName) {
  return !TEST_FILE.test(fileName) && (STYLESHEET.test(fileName) || SCRIPT.test(fileName));
}

/**
 * What one file contributes, split into references and definitions.
 *
 * A test file contributes neither. Fixtures name variables that do not exist
 * precisely because that is the case under test, and a property set to satisfy
 * one assertion is not a property anything ships.
 */
export function collect(fileName, text) {
  if (!isScanned(fileName)) return { refs: [], defs: [] };
  // References from the file as written, definitions from the code alone.
  const code = withoutComments(fileName, text);
  if (STYLESHEET.test(fileName)) {
    return { refs: names(text, REF_NO_FALLBACK), defs: names(code, CSS_DEF) };
  }
  return {
    refs: names(text, REF_NO_FALLBACK),
    defs: [...names(code, CSS_DEF), ...names(code, SET_PROPERTY_DEF)],
  };
}

/**
 * Every fallback-less reference in the given files, and which of them nothing
 * defines. Each name remembers the first file that referenced it, because that
 * is the file somebody has to open.
 *
 * `refs` is keyed by name and so counts distinct variables, while `total`
 * counts the reference sites themselves. They are different numbers here by a
 * factor of about two, and reporting one under the other's name overstates the
 * reach of the walk.
 */
export function audit(files) {
  const refs = new Map();
  const defs = new Set();
  let total = 0;
  for (const { path, text } of files) {
    const found = collect(path, text);
    total += found.refs.length;
    for (const name of found.refs) if (!refs.has(name)) refs.set(name, path);
    for (const name of found.defs) defs.add(name);
  }
  const missing = [...refs.keys()].filter((name) => !defs.has(name)).sort();
  return { refs, defs, missing, total };
}

/** `packages/,*,/src`, sorted, skipping packages that ship no source directory. */
export function packageSourceDirs(root) {
  const packagesDir = join(root, 'packages');
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir)
    .sort()
    .map((name) => join(packagesDir, name, 'src'))
    .filter((path) => existsSync(path) && statSync(path).isDirectory());
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function main() {
  const dirs = packageSourceDirs(repoRoot);
  if (dirs.length === 0) {
    console.error('[css-vars] FAILED: no packages/*/src to scan, so nothing was checked.');
    console.error('[css-vars] run this from the repository root: pnpm test:css-vars');
    process.exit(1);
  }

  const files = dirs
    .flatMap((dir) => walk(dir))
    .filter((path) => isScanned(path))
    .map((path) => ({ path: relative(repoRoot, path), text: readFileSync(path, 'utf8') }));

  const { refs, missing, total } = audit(files);
  if (missing.length > 0) {
    console.error('[css-vars] FAILED: var(--dm-X) without fallback and no definition:');
    console.error('');
    for (const name of missing) console.error(`  - ${name}  (first ref in ${refs.get(name)})`);
    console.error('');
    console.error('[css-vars] define the variable in packages/theme/src/_variables.scss and in');
    console.error('[css-vars] themes/_light.scss and themes/_dark.scss, or set it from');
    console.error("[css-vars] TypeScript with style.setProperty('--dm-X', value). If it belongs");
    console.error('[css-vars] to somebody else, add a fallback at the use site instead:');
    console.error('[css-vars] var(--dm-X, fallback).');
    process.exit(1);
  }

  console.log(
    `[css-vars] OK - ${total} fallback-less references to ${refs.size} variables ` +
      `across ${files.length} files in ${dirs.length} packages, all defined`
  );
}

// Importable for the unit tests, executable as the gate.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
