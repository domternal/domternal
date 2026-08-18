#!/usr/bin/env node
// Third-party notice gate. The packages below embed material from other
// projects directly in their shipped artifacts (icon path data, adapted
// stylesheet rules), and MIT requires the upstream copyright and permission
// notice to travel with substantial portions. This check fails the build
// when a notice file goes missing, falls out of the published tarball, or
// loses the copyright line it exists to carry.
//
// Packages that only IMPORT icons from @domternal/core (the wrappers, the
// block extensions) need no entry: core's own notice covers its artwork,
// and the umbrella pm package re-exports prosemirror as regular
// dependencies whose licenses arrive in node_modules.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const REQUIRED = [
  {
    package: 'packages/core',
    markers: ['Phosphor Icons', 'Copyright (c) 2023 Phosphor Icons'],
    reason: 'src/icons/phosphor.ts inlines the Phosphor icon set',
  },
  {
    package: 'packages/extension-table',
    markers: ['Phosphor Icons', 'Copyright (c) 2023 Phosphor Icons'],
    reason: 'src/icons.ts inlines Phosphor and Phosphor-derived glyphs',
  },
  {
    package: 'packages/theme',
    markers: ['prosemirror-view', 'prosemirror-gapcursor', 'prosemirror-tables', 'Marijn Haverbeke'],
    reason: 'src/_prosemirror.scss adapts the upstream ProseMirror stylesheets',
  },
];

// Every notice must carry the MIT permission sentence, or it is a credit,
// not a license notice.
const MIT_SENTENCE = 'Permission is hereby granted, free of charge';

const failures = [];
for (const entry of REQUIRED) {
  const dir = join(repoRoot, entry.package);
  let notice = '';
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
  for (const marker of [...entry.markers, MIT_SENTENCE]) {
    if (!notice.includes(marker)) {
      failures.push(`${entry.package}: notice lost the required text "${marker}"`);
    }
  }
}

if (failures.length > 0) {
  console.error('[third-party-notices] FAILED:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`[third-party-notices] OK: ${String(REQUIRED.length)} packages carry their notices`);
