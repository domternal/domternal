/**
 * Removes comments from a TypeScript fixture before a gate reads it as text.
 *
 * Both coverage checks in this directory answer "does the fixture exercise
 * this?" by matching a regex against the fixture source. A regex cannot tell
 * code from a comment, so commenting a line out leaves the match in place: the
 * gate keeps counting an import or a command call that tsc never compiles, and
 * prints a coverage number that is not merely optimistic but false. An
 * adversarial review defeated `cjs-coverage-check.mjs` exactly that way, by
 * commenting out one `import toc = require('@domternal/extension-toc')` and
 * deleting its two uses: the gate still reported 12 of 12 entries imported
 * while `packages/extension-toc/dist/index.d.cts` was never loaded.
 *
 * The same reasoning applies next door: `tests/third-party-notices/check.mjs`
 * carries its own `stripComments` for its own reading of tsup configs, and its
 * test file pins it. Gates do not import across directories here, so each
 * keeps the version its input needs. This one walks the text rather than
 * running two replacements, because these fixtures contain URLs inside string
 * literals (`setLink({ href: 'https://example.com' })`) and a regex that eats
 * from `//` to end of line would cut one of those in half.
 *
 * The walk knows strings, template literals and both comment forms. It does
 * not know regex literals, so a `/` starting one would read as a comment: no
 * fixture here has one, and the failure direction is the safe one, since text
 * wrongly dropped can only make a gate demand more coverage, never less.
 *
 * Newlines inside removed comments are kept, so a line number reported against
 * the stripped text still points at the right line of the original.
 */
export function stripComments(source) {
  let out = '';
  let quote = null;
  let comment = null;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (comment === 'line') {
      if (char === '\n') {
        comment = null;
        out += char;
      }
      continue;
    }

    if (comment === 'block') {
      if (char === '*' && next === '/') {
        comment = null;
        i += 1;
      } else if (char === '\n') {
        out += char;
      }
      continue;
    }

    if (quote !== null) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      out += char;
      continue;
    }

    if (char === '/' && next === '/') {
      comment = 'line';
      i += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      comment = 'block';
      i += 1;
      continue;
    }

    out += char;
  }

  return out;
}
