#!/usr/bin/env node
/**
 * Fails when a registration passes the wrong export for its module.
 *
 * The duplicate registry compares by object identity, so every caller
 * registering the same module name MUST hand it the same export. Pass
 * `Fragment` from one call site and `Schema` from another and the registry
 * reports a conflict between two packages that agree perfectly: a false alarm,
 * which is the fastest way to get a check switched off for good.
 *
 * Nothing in the type system can express that. The signature takes `object`,
 * because it has to: the whole point is to accept a class from a copy this
 * code cannot name. So the contract is written down in a table, and this gate
 * is what makes the table true.
 *
 * Three things are held together, and any two of them drifting fails here:
 *
 * 1. the table in `prosemirrorSingleton.ts`, which is what a reader is told,
 * 2. `FROZEN` below, which is what CI enforces,
 * 3. every call site in `packages/,*,/src`, which is what actually runs.
 *
 * Deliberately excluded: `*.test.ts`. Tests register foreign classes on
 * purpose, and that is the behaviour under test rather than a violation.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/**
 * The one export that identifies each module, FROZEN across both packages and
 * every version of them.
 *
 * Chosen once and never revisited: a mixed-version install has an old package
 * on one side of the registry and a new one on the other, so changing an entry
 * here silently stops detecting the duplicate it was meant to catch. Add a new
 * module instead.
 */
export const FROZEN = {
  'prosemirror-model': 'Fragment',
  'prosemirror-state': 'Plugin',
  'prosemirror-view': 'EditorView',
  'prosemirror-transform': 'Transform',
  'prosemirror-tables': 'CellSelection',
  yjs: 'Doc',
  'y-prosemirror': 'ySyncPluginKey',
  '@domternal/core': 'ExtensionConfigurationError',
};

/** The functions that write into the registry. */
const REGISTRARS = [
  'registerProseMirrorCopy',
  'assertSingleProseMirrorCopy',
  'warnOnDuplicateProseMirrorCopy',
];

/**
 * A consumer label that marks a registration as OBSERVED rather than declared.
 *
 * Those calls exist to report what ANOTHER library holds: the class
 * y-prosemirror built a fragment with, or the one the application's own Y.Doc
 * came from. By construction they cannot pass our export, since passing ours
 * would defeat the whole point, so they are exempt from the table and instead
 * required to say so in the label a reader will see.
 */
const OBSERVED = /\((via|the) /;

/** Drops comments, so prose naming an export is not read as a call. */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * The argument list of every registrar call, as raw source text.
 *
 * Parenthesis-matched rather than regex-terminated: these calls are routinely
 * written across four lines, and a template literal in the consumer argument
 * carries its own braces.
 */
export function collectCalls(source) {
  const text = stripComments(source);
  const calls = [];
  for (const name of REGISTRARS) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(`${name}(`, from);
      if (at === -1) break;
      from = at + name.length;
      /* A definition or an import, not a call: `export function register...(`
         and `import { register... }` both contain the name. Only a call has a
         value in front of it that is not a declaration keyword. */
      const before = text.slice(Math.max(0, at - 40), at);
      if (/\b(function|import|export)\s+[\w{,\s]*$/.test(before)) continue;

      const open = text.indexOf('(', at);
      let depth = 0;
      let end = -1;
      for (let i = open; i < text.length; i += 1) {
        const char = text[i];
        if (char === '(') depth += 1;
        else if (char === ')') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end === -1) continue;
      calls.push({ name, args: text.slice(open + 1, end) });
    }
  }
  return calls;
}

/** Splits an argument list on top-level commas only. */
export function splitArgs(args) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of args) {
    if ('([{`'.includes(char)) depth += 1;
    else if (')]}'.includes(char)) depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** `Y.Doc` and `Doc` are the same export; the namespace is import style. */
export function bareName(expression) {
  const parts = expression.split('.');
  return parts[parts.length - 1].trim();
}

/** Every violation in one file's source. */
export function auditSource(source) {
  const problems = [];
  for (const call of collectCalls(source)) {
    const args = splitArgs(call.args);
    if (args.length < 3) continue;
    const [moduleArg, copyArg, consumerArg] = args;

    const literal = /^['"]([^'"]+)['"]$/.exec(moduleArg);
    if (!literal) {
      problems.push({
        kind: 'unreadable',
        detail: `${call.name}(${moduleArg}, ...) does not name its module literally`,
      });
      continue;
    }
    const module = literal[1];
    const expected = FROZEN[module];
    if (!expected) {
      problems.push({
        kind: 'unlisted',
        detail: `${module} is registered but missing from the frozen table`,
      });
      continue;
    }
    if (OBSERVED.test(consumerArg)) continue;
    if (bareName(copyArg) !== expected) {
      problems.push({
        kind: 'wrong-export',
        detail: `${module} must be registered with \`${expected}\`, not \`${copyArg}\``,
      });
    }
  }
  return problems;
}

/** The markdown table in the registry's own header, as `{module: export}`. */
export function parseDocumentedTable(source) {
  const table = {};
  for (const line of source.split('\n')) {
    const row = /^\s*\*\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/.exec(line);
    if (row) table[row[1]] = row[2];
  }
  return table;
}

/** Source files that can register, i.e. everything but the tests. */
function sourceFiles(dir, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, found);
      continue;
    }
    if (!/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry)) continue;
    if (/\.test\.[cm]?[jt]sx?$/.test(entry)) continue;
    /* The registry itself forwards a module name it was given, so its own
       calls name nothing literally and never could. Everything that DOES pick a
       module is a caller, and callers are what this gate is about. */
    if (entry === 'prosemirrorSingleton.ts') continue;
    found.push(path);
  }
  return found;
}

/**
 * The advice a conflict prints: the per-manager fix lines and the guide link.
 *
 * Extracted as source text rather than executed, because the two copies live in
 * two repositories and only one of them is ever installed at a time.
 */
export function extractAdvice(source) {
  const fixes = /const FIXES = \[([\s\S]*?)\];/.exec(source);
  const url = /const DOCS_URL = '([^']+)';/.exec(source);
  return {
    /* Whitespace collapsed and a trailing comma dropped: the two copies are
       formatted by two prettier runs in two repositories, so line breaks and a
       dangling comma are not drift. A changed word is. */
    fixes: fixes ? fixes[1].replace(/\s+/g, ' ').trim().replace(/,$/, '') : null,
    url: url ? url[1] : null,
  };
}

/** Where the registry's own header table lives, first match wins. */
const TABLE_SOURCES = [
  'packages/core/src/utils/prosemirrorSingleton.ts',
  'packages/core/src/prosemirrorSingleton.ts',
];

/**
 * The same file in the sibling repository, looked for in both directions so
 * one copy of this gate serves both. Absent in a public clone and in CI, where
 * it is skipped rather than failed.
 */
const SIBLING_SOURCES = [
  'domternal-pro/packages/core/src/prosemirrorSingleton.ts',
  '../packages/core/src/utils/prosemirrorSingleton.ts',
];

function main() {
  const problems = [];

  const tablePath = TABLE_SOURCES.map((rel) => join(repoRoot, rel)).find((path) =>
    existsSync(path)
  );
  if (!tablePath) {
    console.error('[frozen-contract] FAILED: no prosemirrorSingleton.ts to read the table from');
    process.exit(1);
  }
  const documented = parseDocumentedTable(readFileSync(tablePath, 'utf8'));
  for (const [module, expected] of Object.entries(FROZEN)) {
    if (documented[module] !== expected) {
      problems.push({
        file: relative(repoRoot, tablePath),
        kind: 'table-drift',
        detail: `the header table says ${module} -> ${documented[module] ?? 'nothing'}, this gate says ${expected}`,
      });
    }
  }

  /* The sibling repository's copy of the same registry, when this checkout has
     one. The two implementations are deliberately separate, so that a customer
     holding a core older than the Pro packages still gets a working check; the
     price is two message builders that a reader sees side by side, one from the
     editor and one from a Pro package, for a single duplicated module. If those
     drift, the reader is handed two different recipes and has to guess.

     Compared as SOURCE, not at runtime: the installed core is routinely a
     release behind the Pro package next to it, so comparing what actually runs
     would fail for a reason true of every real install. What must not drift is
     what the two repositories say they will print. */
  const sibling = SIBLING_SOURCES.map((rel) => join(repoRoot, rel)).find((path) =>
    existsSync(path)
  );
  if (sibling) {
    const mine = extractAdvice(readFileSync(tablePath, 'utf8'));
    const theirs = extractAdvice(readFileSync(sibling, 'utf8'));
    if (mine.fixes !== theirs.fixes) {
      problems.push({
        file: relative(repoRoot, sibling),
        kind: 'advice-drift',
        detail: 'the per-manager fix lines differ from this repository\'s',
      });
    }
    if (mine.url !== theirs.url) {
      problems.push({
        file: relative(repoRoot, sibling),
        kind: 'advice-drift',
        detail: `the guide link differs: ${String(mine.url)} here, ${String(theirs.url)} there`,
      });
    }
  }

  const packagesDir = join(repoRoot, 'packages');
  let scanned = 0;
  for (const pkg of existsSync(packagesDir) ? readdirSync(packagesDir).sort() : []) {
    for (const file of sourceFiles(join(packagesDir, pkg, 'src'))) {
      scanned += 1;
      for (const problem of auditSource(readFileSync(file, 'utf8'))) {
        problems.push({ file: relative(repoRoot, file), ...problem });
      }
    }
  }

  if (problems.length > 0) {
    console.error('[frozen-contract] FAILED: the single-copy registry contract is not being kept:');
    console.error('');
    for (const { file, detail } of problems) console.error(`  - ${file}: ${detail}`);
    console.error('');
    console.error('[frozen-contract] Every caller registering a module must pass the SAME export,');
    console.error('[frozen-contract] or two packages that agree will report a conflict that does');
    console.error('[frozen-contract] not exist. The table is in prosemirrorSingleton.ts and in');
    console.error('[frozen-contract] tests/frozen-contract/check.mjs, and both must agree:');
    console.error('[frozen-contract] https://domternal.dev/v1/guides/single-prosemirror-copy/');
    process.exit(1);
  }

  console.log(
    `[frozen-contract] OK - ${Object.keys(FROZEN).length} frozen modules, ` +
      `${scanned} source files, every registration matches`
  );
}

// Importable for the unit tests, executable as the gate.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
