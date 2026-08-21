#!/usr/bin/env node
/**
 * Fails when a shipped package carries somebody else's code without the notice
 * that code's license requires.
 *
 * Third-party material reaches a tarball here in two ways, and the two need
 * opposite treatments.
 *
 * ## Material embedded by hand, which nothing can discover
 *
 * `packages/core` pastes Phosphor icon path data into `src/icons/phosphor.ts`,
 * `packages/extension-table` does the same in `src/icons.ts`, and
 * `packages/theme` adapts the upstream ProseMirror stylesheets by hand into
 * `src/_prosemirror.scss`. None of that leaves a trace a tool could find. There
 * is no dependency edge and no bundler setting: Phosphor is not a dependency of
 * core, `prosemirror-view` is not a dependency of theme, and theme is built by
 * `sass` with no bundler in the picture at all. So those three are listed by
 * hand below, and each entry names the file that carries the material, so the
 * entry cannot quietly outlive a rename and go on guarding nothing.
 *
 * The one discoverable fact about this half is the notice file itself, so every
 * `THIRD-PARTY-LICENSES.md` under `packages/` has to be accounted for by
 * something here. A notice no check reads is a notice that can be emptied
 * without a sound. What stays undiscoverable is the opposite case: a package
 * that starts embedding artwork and never writes a notice at all. Only review
 * catches that one, which is why the list below is short and deliberate.
 *
 * ## Dependencies bundled by tsup, which ARE discoverable and so are discovered
 *
 * tsup externalises `dependencies` and `peerDependencies`, so an ordinary
 * dependency reaches the customer as its own package under `node_modules`,
 * carrying its own LICENSE. `noExternal` reverses that: the dependency is
 * inlined into `dist`, esbuild drops its license header on the way in, and this
 * notice file becomes the only copy of that license the customer will ever
 * receive.
 *
 * No package here declares `noExternal` today, so this half currently guards
 * nothing, and that is exactly the point. The failure it exists for is a green
 * build: somebody adds one entry to one tsup config, the tarball starts
 * carrying somebody else's MIT or Apache code with the header stripped, and a
 * hardcoded list of three packages goes on printing OK release after release.
 * The sibling Pro repository supplied the near miss this half is ported from,
 * where a notice named a bundled dependency while claiming it was not bundled.
 *
 * So the bundled half is derived from the build configuration rather than
 * written down: whatever a tsup config inlines must be declared as bundled in
 * that package's notice, must not be denied anywhere in it, and must bring
 * whatever text its own license demands be reproduced.
 *
 * Both sides of that comparison are read strictly, because both have a slack
 * reading that passes while nothing is checked. On the notice side a name is
 * matched as a whole npm name and never as a substring: a section declaring
 * "remend-utils (MIT)" says nothing about a bundled "remend", and a substring
 * test would let the neighbour's MIT sentence answer for a package whose own
 * license was never reproduced. On the config side a config that keeps its
 * settings somewhere else, by importing another config, by spreading a value
 * written elsewhere, or by exporting anything but a literal, is reported as
 * unreadable rather than scanned and found empty. Every config here is
 * self-contained today, so that rule costs nothing and closes the last way to
 * declare `noExternal` where this cannot see it.
 *
 * ## Why the "files" array is checked and not only the notice
 *
 * `@domternal/core` 0.15.0 published Phosphor path data with no notice in the
 * tarball at all: `"files"` read `["dist"]`, and npm carries LICENSE by itself
 * but never THIRD-PARTY-LICENSES.md. A notice that sits in the repository and
 * misses the tarball satisfies nobody, so wherever a notice is required its
 * presence in `"files"` is required with it. That check is what makes the 0.15.0
 * shape impossible to repeat.
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/**
 * Packages that embed third-party material directly in their own source.
 *
 * `source` is the file the material lives in. It is checked to exist and to be
 * named by the notice, because an entry pointing at a file nobody kept is an
 * entry that passes while protecting nothing.
 */
export const REQUIRED = [
  {
    package: 'packages/core',
    source: 'src/icons/phosphor.ts',
    markers: ['Phosphor Icons', 'Copyright (c) 2023 Phosphor Icons'],
    reason: 'src/icons/phosphor.ts inlines the Phosphor icon set',
  },
  {
    package: 'packages/extension-table',
    source: 'src/icons.ts',
    markers: ['Phosphor Icons', 'Copyright (c) 2023 Phosphor Icons'],
    reason: 'src/icons.ts inlines Phosphor and Phosphor-derived glyphs',
  },
  {
    package: 'packages/theme',
    source: 'src/_prosemirror.scss',
    markers: ['prosemirror-view', 'prosemirror-gapcursor', 'prosemirror-tables', 'Marijn Haverbeke'],
    reason: 'src/_prosemirror.scss adapts the upstream ProseMirror stylesheets',
  },
];

// Every notice must carry the MIT permission sentence, or it is a credit,
// not a license notice.
export const MIT_SENTENCE = 'Permission is hereby granted, free of charge';

/** Config file names tsup will pick up, so a rename cannot end the discovery. */
export const TSUP_CONFIGS = [
  'tsup.config.ts',
  'tsup.config.mts',
  'tsup.config.cts',
  'tsup.config.js',
  'tsup.config.mjs',
  'tsup.config.cjs',
];

/**
 * Drops comments before the config is scanned.
 *
 * A commented-out `noExternal` is not a bundling instruction, and reading one
 * as if it were would demand a notice for a dependency nothing inlines. A false
 * alarm is the fastest way to get a gate switched off.
 */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * The body of the array literal starting at `from`, or null if it never closes.
 *
 * Bracket-matched with string awareness rather than regex-terminated, so a `]`
 * inside a quoted entry does not end the list early.
 */
export function readArrayLiteral(text, from) {
  if (text[from] !== '[') return null;
  let depth = 0;
  let quote = null;
  for (let i = from; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '[') depth += 1;
    else if (char === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(from + 1, i);
    }
  }
  return null;
}

/**
 * Every `noExternal` declaration in a tsup config, as
 * `{ bundled, readable, value }`.
 *
 * `readable` is false whenever the declaration is not a plain list of string
 * literals: a regular expression, an identifier, a spread, a template literal
 * or a value that is not an array at all. Those are reported rather than waved
 * through, because a declaration this cannot read is a declaration it cannot
 * vouch for, and `noExternal: bundledDeps` reads as "nothing bundled" to any
 * check that only looks for `[...]`.
 */
export function parseNoExternal(configText) {
  const text = stripComments(configText);
  const declarations = [];
  for (const match of text.matchAll(/\bnoExternal\s*:/g)) {
    const after = text.slice(match.index + match[0].length);
    const offset = after.search(/\S/);
    /* The first line of whatever was written, so an unreadable declaration can
       be quoted back at whoever has to fix it. */
    const start = offset === -1 ? 0 : offset;
    const value = after.slice(start, start + 60).split('\n')[0].trim();
    if (offset === -1 || after[offset] !== '[') {
      declarations.push({ bundled: [], readable: false, origin: 'noExternal', value });
      continue;
    }
    const body = readArrayLiteral(after, offset);
    if (body === null) {
      declarations.push({ bundled: [], readable: false, origin: 'noExternal', value });
      continue;
    }
    const bundled = [...body.matchAll(/'([^']*)'|"([^"]*)"/g)].map((entry) => entry[1] ?? entry[2]);
    const leftover = body
      .replace(/'[^']*'|"[^"]*"/g, '')
      .replace(/,/g, '')
      .trim();
    declarations.push({
      bundled,
      readable: leftover === '',
      origin: 'noExternal',
      value: leftover === '' ? value : leftover,
    });
  }
  return declarations;
}

/**
 * The expression spread at `from`, which is the offset just past the `...`.
 *
 * Read to the first `,`, `}` or `]` that is not inside brackets or quotes, so
 * `...withBase({ a: 1 })` comes back whole rather than cut at its first comma.
 */
export function readSpreadOperand(text, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) return text.slice(from, i).trim();
      depth -= 1;
      continue;
    }
    if (char === ',' && depth === 0) return text.slice(from, i).trim();
  }
  return text.slice(from).trim();
}

/**
 * The default export of a config, when it is not a shape this can read, else
 * null.
 *
 * `defineConfig({ ... })` and a bare object or array literal are readable: the
 * settings are written in the file, so the `noExternal` scan above sees all of
 * them. Anything else, an identifier, a call, a function, a re-export, or no
 * default export at all, can produce settings written somewhere else, and a
 * scan that finds no `noExternal` in the file would call that "bundles
 * nothing".
 */
export function readConfigExport(text) {
  const match = /\bexport\s+default\s+|\bmodule\.exports\s*=\s*/.exec(text);
  if (!match) {
    return { bundled: [], readable: false, origin: 'export', value: 'no default export' };
  }
  let rest = text.slice(match.index + match[0].length).trimStart();
  if (/^defineConfig\s*\(/.test(rest)) rest = rest.slice(rest.indexOf('(') + 1).trimStart();
  if (rest.startsWith('{') || rest.startsWith('[')) return null;
  return {
    bundled: [],
    readable: false,
    origin: 'export',
    value: rest.slice(0, 60).split('\n')[0].trim(),
  };
}

/**
 * Everything in a tsup config that keeps part of the configuration out of
 * sight, as unreadable declarations.
 *
 * `parseNoExternal` reads the file it is handed and nothing else, so a config
 * built on a shared base scans clean and reports that the package bundles
 * nothing:
 *
 *     import base from '../../tsup.base.ts';
 *     export default defineConfig({ ...base, entry: ['src/index.ts'] });
 *
 * That is the same silent pass as `noExternal: bundledDeps`, moved one file
 * away, so it gets the same answer: report it, and let a person either inline
 * the setting or teach this to follow it. A spread of an object literal
 * declared in the same file is not reported, because the scan above already
 * read it wherever it sits.
 */
export function findHiddenConfig(configText) {
  const text = stripComments(configText);
  const found = [];

  for (const [, specifier] of [
    ...text.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g),
    ...text.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g),
    ...text.matchAll(/\bimport\s+['"]([^'"]+)['"]/g),
  ]) {
    /* A bare specifier is a package, and `tsup` itself is imported by every
       config here. Only a path this repository owns can hold a config. */
    if (!/^[./]/.test(specifier)) continue;
    if (!/tsup|config/i.test(specifier.split('/').pop())) continue;
    found.push({ bundled: [], readable: false, origin: 'import', value: specifier });
  }

  for (const match of text.matchAll(/[{[,]\s*\.\.\./g)) {
    const operand = readSpreadOperand(text, match.index + match[0].length);
    if (operand === '' || operand.startsWith('{') || operand.startsWith('[')) continue;
    const root = /^[A-Za-z_$][\w$]*/.exec(operand)?.[0] ?? '';
    /* A value declared as a literal in this same file hides nothing, since the
       noExternal scan reads every line of the file wherever the setting sits. */
    const declaredHere =
      root !== '' && new RegExp(`\\b(?:const|let|var)\\s+${root}\\b[^=\\n]*=\\s*[{[]`).test(text);
    if (declaredHere) continue;
    found.push({ bundled: [], readable: false, origin: 'spread', value: `...${operand}` });
  }

  const exported = readConfigExport(text);
  if (exported !== null) found.push(exported);
  return found;
}

/** Every declaration a tsup config makes about bundling, readable or not. */
export function readTsupBundling(configText) {
  return [...parseNoExternal(configText), ...findHiddenConfig(configText)];
}

/** What to print about a declaration this cannot read, and what to do about it. */
export function unreadableReason({ origin, value }) {
  if (origin === 'import') {
    return `takes configuration from "${value}", a file this check does not read, so a noExternal declared there would inline a dependency and demand no notice for it; keep the tsup config self-contained, or teach readTsupBundling to follow the import`;
  }
  if (origin === 'spread') {
    return `spreads \`${value}\` into its configuration, which this check cannot see, so a noExternal hidden in it would ship undeclared; spread only object literals written in this config, or teach readTsupBundling to follow it`;
  }
  if (origin === 'export') {
    return `exports \`${value}\` rather than a configuration literal, so this check cannot tell what it bundles; write the config out as defineConfig({ ... }), or teach readTsupBundling the new shape`;
  }
  return `declares noExternal as \`${value}\`, which this check cannot read; use plain string literals so what ships can be told from the config, or teach parseNoExternal the new shape`;
}

/** Splits a notice into `{ heading, body }` sections at every ATX heading. */
export function sections(notice) {
  const found = [];
  let current = null;
  for (const line of notice.split('\n')) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      current = { heading: heading[1].trim(), body: [] };
      found.push(current);
      continue;
    }
    if (current) current.body.push(line);
  }
  return found;
}

/**
 * True when a heading declares its section to be about bundled code.
 *
 * The denial is tested first on purpose: "Not bundled" contains the word
 * bundled, and reading that as a bundling declaration would let the exact
 * mistake this exists to catch pass as a fix for itself.
 */
export function saysBundled(heading) {
  if (/\b(not|never)\s+(bundled|inlined)\b|\bunbundled\b|\bexternal(ised|ized)?\b/i.test(heading)) {
    return false;
  }
  return /\bbundled\b|\binlined\b/i.test(heading);
}

/** Every affirmatively bundled section of a notice, heading included, as text. */
export function bundledDeclarations(notice) {
  return sections(notice)
    .filter((section) => saysBundled(section.heading))
    .map((section) => [section.heading, ...section.body].join('\n'))
    .join('\n');
}

/** Escapes a package name so it can be matched literally inside a pattern. */
export function escapeForRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `dep` as a pattern that matches the whole package name and nothing longer.
 *
 * `\b` is no help here. The characters npm names are built from, `-`, `.`,
 * `/`, `@`, are the same characters JavaScript calls non-word, so `\bremend\b`
 * matches the `remend` inside `remend-utils` exactly as a substring test does.
 * The boundary below is that name alphabet instead, so a name is only found
 * where the name really ends. A trailing full stop is allowed to end a
 * sentence but not to start another name segment: "inlines remend." is a
 * mention of remend, `remend.merge` is not. A version suffix or a subpath does
 * still refer to the same package, so `remend@1.2.3` and `remend/dist` count.
 */
export function boundedName(dep) {
  return `(?<![A-Za-z0-9._~+@/-])${escapeForRegExp(dep)}(?![A-Za-z0-9_~+-])(?!\\.[A-Za-z0-9_~+-])`;
}

/**
 * True when `text` names this package, rather than merely containing its name.
 *
 * The distinction is the whole point: a bundled dependency is only declared
 * when the notice names it, and the neighbour whose name it is a prefix of
 * declares nothing on its behalf.
 */
export function mentionsPackage(text, dep) {
  return new RegExp(boundedName(dep), 'i').test(text);
}

/**
 * True when the notice claims this dependency is not bundled.
 *
 * Scoped and dotted names are escaped and bounded before matching, so
 * `lodash.merge` and `@scope/name` are searched for as themselves rather than
 * as patterns, and "remend-utils is not bundled" is not read as a claim about
 * remend.
 */
export function deniesBundling(notice, dep) {
  const name = boundedName(dep);
  return new RegExp(`(?:not|never)\\s+bundled[^.]*${name}|${name}[^.]*(?:not|never)\\s+bundled`, 'i').test(
    notice
  );
}

/**
 * What each license demands be reproduced alongside the code it covers.
 *
 * A `marker` of null means the license asks for nothing to travel with a
 * binary, so declaring the bundling is the whole obligation.
 */
export const LICENSE_TEXT = [
  { id: /^MIT(-0)?$/i, marker: MIT_SENTENCE, label: 'the MIT permission sentence' },
  {
    id: /^ISC$/i,
    marker: 'Permission to use, copy, modify, and/or distribute this software',
    label: 'the ISC permission sentence',
  },
  {
    id: /^BSD-[234](-Clause.*)?$/i,
    marker: 'Redistribution and use in source and binary forms',
    label: 'the BSD redistribution clause',
  },
  {
    id: /^Apache-2\.0$/i,
    marker: 'TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION',
    label: 'the full Apache 2.0 text',
  },
  { id: /^(0BSD|Unlicense|CC0-1\.0|WTFPL|BlueOak-1\.0\.0)$/i, marker: null, label: null },
];

/**
 * Licenses that make bundling a decision rather than a paperwork step.
 *
 * Inlining one of these into an MIT package is a licensing question for a
 * person, so the gate stops rather than asking for a paragraph of text and
 * calling the matter settled.
 */
export const NEEDS_REVIEW = /^(GPL|AGPL|LGPL|SSPL|MPL|EPL|CDDL|OSL|BUSL|Elastic|SEE\s+LICENSE|UNLICENSED)/i;

/**
 * What a license field demands of the notice.
 *
 * Returns `{ kind: 'text', markers, label }` when at least one of the markers
 * must appear, `{ kind: 'none' }` when the license asks for nothing, and
 * `{ kind: 'review' }` or `{ kind: 'unknown' }` when a person has to look.
 *
 * A dual license (`MIT OR Apache-2.0`) is satisfied by either side, since the
 * distributor picks. A conjunction (`MIT AND CC-BY-4.0`) is not resolved here:
 * two licenses at once is rare enough that guessing is worse than stopping.
 */
export function licenseDemands(license) {
  const raw = String(license ?? '').trim();
  if (raw === '') return { kind: 'unknown', detail: 'declares no license field' };
  if (/\sAND\s/i.test(raw)) {
    return { kind: 'unknown', detail: `combines several licenses ("${raw}")` };
  }
  const alternatives = raw
    .replace(/[()]/g, ' ')
    .split(/\s+OR\s+/i)
    .map((part) => part.trim())
    .filter((part) => part !== '');

  const markers = [];
  const labels = [];
  let permissive = false;
  for (const id of alternatives) {
    const known = LICENSE_TEXT.find((candidate) => candidate.id.test(id));
    if (!known) {
      if (NEEDS_REVIEW.test(id)) continue;
      return { kind: 'unknown', detail: `declares a license this check does not know ("${id}")` };
    }
    permissive = true;
    if (known.marker) {
      markers.push(known.marker);
      labels.push(known.label);
    }
  }
  if (!permissive) return { kind: 'review', detail: `is ${raw}` };
  if (markers.length === 0) return { kind: 'none' };
  return { kind: 'text', markers, label: labels.join(' or ') };
}

/**
 * Everything wrong with one package's notice, given the facts about it.
 *
 * Pure so the whole bundled half can be exercised against hand-written shapes.
 * `notice` is null when the file is absent, and `licenseOf` returns the license
 * field of a bundled dependency or null when its manifest could not be read.
 */
export function auditBundled(pkgRel, { notice, files, bundled, licenseOf }) {
  const failures = [];
  const list = [...bundled].sort();
  if (notice === null) {
    failures.push(
      `${pkgRel}: bundles ${list.join(', ')} but has no THIRD-PARTY-LICENSES.md; bundling strips the upstream header out of dist, so the notice is the only copy the customer gets`
    );
    return failures;
  }
  if (!Array.isArray(files) || !files.includes('THIRD-PARTY-LICENSES.md')) {
    failures.push(
      `${pkgRel}: THIRD-PARTY-LICENSES.md is not in the "files" array, so npm pack drops it`
    );
  }
  const declared = bundledDeclarations(notice);
  for (const dep of list) {
    if (!mentionsPackage(declared, dep)) {
      failures.push(
        `${pkgRel}: bundled dependency "${dep}" is not declared under a heading that says bundled; add it to a "## Bundled dependencies" section of the notice`
      );
    }
    if (deniesBundling(notice, dep)) {
      failures.push(
        `${pkgRel}: the notice claims "${dep}" is not bundled while tsup inlines it; correct the notice, the tsup config decides what ships`
      );
    }
    const license = licenseOf(dep);
    if (license === null) {
      failures.push(
        `${pkgRel}: could not read the license of bundled dependency "${dep}"; install it so its manifest can be read, this check will not pass a bundled dependency it cannot identify`
      );
      continue;
    }
    const demands = licenseDemands(license);
    if (demands.kind === 'review') {
      failures.push(
        `${pkgRel}: bundled dependency "${dep}" ${demands.detail}, which is a licensing decision rather than a notice; do not inline it without review`
      );
      continue;
    }
    if (demands.kind === 'unknown') {
      failures.push(
        `${pkgRel}: bundled dependency "${dep}" ${demands.detail}; add it to LICENSE_TEXT in tests/third-party-notices/check.mjs once you know what text it requires`
      );
      continue;
    }
    if (demands.kind === 'text' && !demands.markers.some((marker) => notice.includes(marker))) {
      failures.push(
        `${pkgRel}: "${dep}" is ${license} but the notice lacks ${demands.label}; paste the dependency's LICENSE into the notice`
      );
    }
  }
  return failures;
}

/**
 * The license field of a dependency as installed, or null.
 *
 * pnpm links every direct dependency under the package's own `node_modules`, so
 * that is asked first and answers with the exact copy the build would inline.
 * The workspace root is a fallback for a hoisted copy. The manifest is read from
 * disk rather than through the exports map, because plenty of packages do not
 * export `./package.json` and going that way throws for them.
 */
export function readInstalledLicense(pkgDir, dep, root = repoRoot) {
  for (const base of [join(pkgDir, 'node_modules'), join(root, 'node_modules')]) {
    const dir = join(base, ...dep.split('/'));
    if (!existsSync(dir)) continue;
    try {
      const manifest = JSON.parse(readFileSync(join(realpathSync(dir), 'package.json'), 'utf8'));
      const license =
        typeof manifest.license === 'string' ? manifest.license : (manifest.license?.type ?? '');
      return String(license);
    } catch {
      return null;
    }
  }
  return null;
}

function main() {
  const failures = [];
  const packagesDir = join(repoRoot, 'packages');
  const names = existsSync(packagesDir) ? readdirSync(packagesDir).sort() : [];

  /* Packages something here reads the notice of. Anything left over at the end
     carries a notice no check would notice the emptying of. */
  const guarded = new Set();
  /* One "files" report per package, so a package that both embeds artwork and
     bundles a dependency is not told the same thing twice. */
  const filesReported = new Set();

  // --- 1. embedded material, listed by hand because nothing declares it -----

  for (const entry of REQUIRED) {
    const dir = join(repoRoot, entry.package);
    guarded.add(entry.package);
    let notice;
    try {
      notice = readFileSync(join(dir, 'THIRD-PARTY-LICENSES.md'), 'utf8');
    } catch {
      failures.push(`${entry.package}: THIRD-PARTY-LICENSES.md is missing (${entry.reason})`);
      continue;
    }
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (!Array.isArray(manifest.files) || !manifest.files.includes('THIRD-PARTY-LICENSES.md')) {
      failures.push(
        `${entry.package}: THIRD-PARTY-LICENSES.md is not in the "files" array, so npm pack drops it`
      );
    }
    filesReported.add(entry.package);
    for (const marker of [...entry.markers, MIT_SENTENCE]) {
      if (!notice.includes(marker)) {
        failures.push(`${entry.package}: notice lost the required text "${marker}"`);
      }
    }
    /* The entry claims a named file carries the material. If that file is gone
       the claim is stale, and a stale entry passes every check above while
       guarding a package that may no longer embed anything at all. */
    if (!existsSync(join(dir, entry.source))) {
      failures.push(
        `${entry.package}: ${entry.source} no longer exists, so this entry guards nothing (${entry.reason}); point it at the file that carries the material today, or drop the entry and the notice together`
      );
    } else if (!notice.includes(entry.source)) {
      failures.push(
        `${entry.package}: the notice does not name ${entry.source}, the file the material lives in; say where it is, so a reader can check the claim`
      );
    }
  }

  // --- 2. bundled dependencies, discovered from the build configuration -----

  let configsScanned = 0;
  let bundledTotal = 0;
  for (const name of names) {
    const dir = join(packagesDir, name);
    const pkgRel = `packages/${name}`;
    const configs = TSUP_CONFIGS.map((file) => join(dir, file)).filter((path) => existsSync(path));
    if (configs.length === 0) continue;
    configsScanned += configs.length;

    const bundled = new Set();
    for (const configPath of configs) {
      const configRel = configPath.slice(repoRoot.length + 1);
      for (const declaration of readTsupBundling(readFileSync(configPath, 'utf8'))) {
        if (!declaration.readable) {
          failures.push(`${pkgRel}: ${configRel} ${unreadableReason(declaration)}`);
          continue;
        }
        for (const dep of declaration.bundled) bundled.add(dep);
      }
    }
    if (bundled.size === 0) continue;

    bundledTotal += bundled.size;
    guarded.add(pkgRel);
    const noticePath = join(dir, 'THIRD-PARTY-LICENSES.md');
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const problems = auditBundled(pkgRel, {
      notice: existsSync(noticePath) ? readFileSync(noticePath, 'utf8') : null,
      files: manifest.files,
      bundled,
      licenseOf: (dep) => readInstalledLicense(dir, dep),
    });
    for (const problem of problems) {
      /* The "files" line is the same sentence part 1 already printed for a
         package that also embeds artwork. */
      if (problem.includes('"files" array') && filesReported.has(pkgRel)) continue;
      failures.push(problem);
    }
    filesReported.add(pkgRel);
  }

  // --- 3. no notice sits here unread --------------------------------------

  for (const name of names) {
    const pkgRel = `packages/${name}`;
    if (guarded.has(pkgRel)) continue;
    if (!existsSync(join(packagesDir, name, 'THIRD-PARTY-LICENSES.md'))) continue;
    failures.push(
      `${pkgRel}: carries a THIRD-PARTY-LICENSES.md that nothing here reads, so it could be emptied without a sound; add an entry to REQUIRED in tests/third-party-notices/check.mjs naming the file that embeds the material`
    );
  }

  if (failures.length > 0) {
    console.error('[third-party-notices] FAILED:');
    console.error('');
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error('');
    console.error('[third-party-notices] Bundling strips the upstream license header out of dist,');
    console.error('[third-party-notices] and npm never packs THIRD-PARTY-LICENSES.md on its own, so');
    console.error('[third-party-notices] the notice file plus the "files" array are the only things');
    console.error('[third-party-notices] carrying an attribution to the customer. Fix the notice');
    console.error('[third-party-notices] rather than this check: a tarball published without one');
    console.error('[third-party-notices] cannot be unpublished back into compliance.');
    process.exit(1);
  }

  console.log(
    `[third-party-notices] OK - ${REQUIRED.length} packages embed third-party material and carry its notice, ` +
      `${configsScanned} tsup configs scanned, ${bundledTotal} bundled dependencies declared`
  );
}

// Importable for the unit tests, executable as the gate.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
