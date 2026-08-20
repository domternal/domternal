#!/usr/bin/env node
/**
 * Fails when `light-tokens` and `dark-tokens` do not declare the same set of
 * `--dm-*` custom properties.
 *
 * The two mixins in `packages/theme/src/themes/` are a matched pair by
 * construction, and `_light.scss` says so in its own header: every token the
 * dark mixin overrides has to be reset by the light one, or a
 * `.dm-theme-light` island inside a dark context keeps the dark value. Nothing
 * held that pairing down. Sass compiles either file happily on its own, both
 * halves are valid CSS whatever they contain, and the css-vars gate next door
 * asks whether a name is defined ANYWHERE rather than whether it is defined on
 * both sides. A token added to one mixin and not the other is therefore
 * invisible to the whole build.
 *
 * ## What made it worth a gate
 *
 * The paper layer re-emits this palette. `_print.scss` includes
 * `light-tokens(' !important')` on `.dm-editor` so a dark document prints as a
 * light one, and the comment there promises that "a token the dark theme gains
 * later is covered here on the day it lands rather than the day somebody
 * prints it". That promise is only as good as the pairing: a token that
 * `dark-tokens` carries and `light-tokens` does not has nothing to reset it on
 * paper, so it prints at its dark value, next to fifty siblings that flipped.
 * Black ink on a black table header is what that looks like, and the only way
 * to see it is to print a dark-themed document and look at the sheet.
 *
 * The other direction has a consequence too, a quieter one. `light-tokens` is
 * emitted `!important` on every printed editor, whether or not the reader ever
 * used a theme class, so a token it carries beyond the dark mixin's set is a
 * token this package overrides on paper for everybody, including a host who
 * deliberately set their own value and never asked for a dark theme. Neither
 * side of the pair is the one that matters, so the comparison is symmetric.
 *
 * ## Why the mixin bodies, and not the two files
 *
 * `_dark.scss` declares thirteen more `--dm-*` names below its mixin, for the
 * floating ToC outline and the inline `/toc` block, and those are correct as
 * they stand: the outline mounts outside `.dm-editor` and cannot be reached by
 * the mixin's selector list, and its light values live in `_variables.scss`
 * rather than in a light mixin. Comparing the files rather than the mixins
 * would report all thirteen, every one of them a false alarm, and a gate that
 * cries wolf is a gate somebody switches off.
 *
 * ## Why a comment cannot declare
 *
 * The same reason the css-vars gate reads definitions from code alone: a
 * declaration parked in a comment while somebody decides what to do with it
 * would answer for the real one. `withoutComments` is imported from that gate
 * rather than written again here, so the two agree on what a comment is. Two
 * gates with two answers to that question means one of them can see a
 * declaration the other cannot, and neither is wrong on its own terms.
 *
 * ## Why a floor on the count
 *
 * This gate compares two sets, and the way a set comparison goes quiet is for
 * both sets to be empty: a renamed mixin, a brace matcher defeated by
 * something new in the body, and two empty sets agree perfectly. So a mixin
 * that cannot be found is a failure rather than an empty result, and a body
 * that yields fewer tokens than any real palette would is a failure as well.
 * Both mixins going thin together is what a broken parse looks like from here;
 * it is not what a stylesheet edit looks like.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSS_DEF, names, withoutComments } from '../css-vars/check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/** The pair, each named by the file it lives in and the mixin inside it. */
export const LIGHT = { path: 'packages/theme/src/themes/_light.scss', mixin: 'light-tokens' };
export const DARK = { path: 'packages/theme/src/themes/_dark.scss', mixin: 'dark-tokens' };

/**
 * Fewer than this from either mixin is read as a parse that failed rather than
 * a palette that shrank. There are 51 in each today, and the number has only
 * ever grown; the floor sits far enough below that a real edit never reaches
 * it, and far enough above zero that a mixin read as empty cannot pass by
 * agreeing with an equally empty twin.
 */
export const MINIMUM_TOKENS = 40;

/**
 * Every body of `@mixin <name>`, in source order.
 *
 * The end of a body is found by matching braces rather than by looking for a
 * `}` in the first column, because Sass has no rule that says the closing
 * brace is not indented and a nested block inside a mixin is ordinary. The
 * count is safe against `#{$important}`, which is what every declaration in
 * `light-tokens` ends with: interpolation opens and closes a brace like
 * anything else, so it cancels out.
 *
 * Several bodies is a real answer rather than an error here, because Sass
 * accepts a mixin defined twice and uses the later definition. Reporting it is
 * the caller's business; returning only the first would compare a body that
 * nothing includes.
 */
export function mixinBodies(text, name) {
  const header = new RegExp(`@mixin\\s+${name}\\s*(?:\\([^)]*\\))?\\s*\\{`, 'g');
  const bodies = [];
  for (const match of text.matchAll(header)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    for (let index = open; index < text.length; index += 1) {
      if (text[index] === '{') depth += 1;
      else if (text[index] === '}') {
        depth -= 1;
        if (depth === 0) {
          bodies.push(text.slice(open + 1, index));
          break;
        }
      }
    }
  }
  return bodies;
}

/**
 * The distinct `--dm-*` names each definition of the file's mixin declares.
 *
 * Distinct rather than counted: a value redeclared inside the body, which is
 * what a conditional override would look like, is one token to everything
 * downstream and should read as one here.
 */
export function declaredTokens({ path, text, mixin }) {
  return mixinBodies(withoutComments(path, text), mixin).map(
    (body) => new Set(names(body, CSS_DEF))
  );
}

/**
 * What the two files declare, and where they disagree.
 *
 * The difference is only computed when both mixins parsed. A set compared
 * against one nobody managed to read reports the whole of the other side,
 * fifty-one names that are all present and correct, under a heading that says
 * they are missing. The structural problem is the thing to fix, and it is the
 * thing this reports.
 */
export function audit(light, dark, minimum = MINIMUM_TOKENS) {
  const problems = [];
  const sets = [];

  for (const file of [light, dark]) {
    const found = declaredTokens(file);
    if (found.length === 0) {
      problems.push(
        `${file.path} declares no @mixin ${file.mixin}, so there was nothing to compare. ` +
          'Either it was renamed, in which case rename it here too, or the body could ' +
          'not be read, in which case this gate is checking nothing.'
      );
      sets.push(new Set());
      continue;
    }
    if (found.length > 1) {
      problems.push(
        `${file.path} defines @mixin ${file.mixin} ${String(found.length)} times. ` +
          'Sass takes the last one, which is the body compared below, and the earlier ' +
          'ones ship in nothing.'
      );
    }
    const tokens = found[found.length - 1];
    if (tokens.size < minimum) {
      problems.push(
        `${file.path} yielded only ${String(tokens.size)} --dm-* properties from ` +
          `@mixin ${file.mixin}, below the floor of ${String(minimum)}. A palette does ` +
          'not shrink like that, so read this as a body that was not parsed rather ' +
          'than a body that was emptied.'
      );
    }
    sets.push(tokens);
  }

  const [lightTokens, darkTokens] = sets;
  const parsed = lightTokens.size > 0 && darkTokens.size > 0;
  return {
    light: lightTokens,
    dark: darkTokens,
    onlyInLight: parsed ? [...lightTokens].filter((name) => !darkTokens.has(name)).sort() : [],
    onlyInDark: parsed ? [...darkTokens].filter((name) => !lightTokens.has(name)).sort() : [],
    problems,
  };
}

/**
 * The lines a failing run prints, empty when there is nothing wrong. Separated
 * from `main` so the difference between "the audit found a disagreement" and
 * "the run says so and fails" is not a step only a person can check.
 */
export function report(result, light = LIGHT, dark = DARK) {
  const lines = [...result.problems];
  for (const name of result.onlyInDark) {
    lines.push(`${name} is declared by ${dark.mixin} and not by ${light.mixin}`);
  }
  for (const name of result.onlyInLight) {
    lines.push(`${name} is declared by ${light.mixin} and not by ${dark.mixin}`);
  }
  return lines;
}

function read(file) {
  try {
    return { ...file, text: readFileSync(join(repoRoot, file.path), 'utf8') };
  } catch {
    console.error(`[theme-tokens] FAILED: cannot read ${file.path}, so nothing was checked.`);
    console.error('[theme-tokens] run this from the repository root: pnpm test:theme-tokens');
    process.exit(1);
  }
}

function main() {
  const result = audit(read(LIGHT), read(DARK));
  const lines = report(result);

  if (lines.length > 0) {
    console.error('[theme-tokens] FAILED: the light and dark palettes are not the same set:');
    console.error('');
    for (const line of lines) console.error(`  - ${line}`);
    console.error('');
    console.error('[theme-tokens] declare the property in BOTH mixins. One that only the dark');
    console.error('[theme-tokens] mixin carries has nothing to reset it when _print.scss re-emits');
    console.error('[theme-tokens] light-tokens on the editor, so it prints at its dark value; one');
    console.error('[theme-tokens] that only the light mixin carries is overridden on paper for');
    console.error('[theme-tokens] every reader, dark theme or not.');
    process.exit(1);
  }

  console.log(
    `[theme-tokens] OK - ${String(result.light.size)} --dm-* properties, declared by ` +
      `${LIGHT.mixin} and ${DARK.mixin} alike`
  );
}

// Importable for the unit tests, executable as the gate.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
