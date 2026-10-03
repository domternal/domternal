#!/usr/bin/env node
/**
 * No personal data in tracked files.
 *
 * Every file Git tracks or would add is scanned for e-mail addresses, home
 * folder, drive and network paths (also as a tool encodes them into a
 * directory name or a JSON string escapes them), file URLs that name a
 * person's folder or another host, author data inside Office packages and
 * capture bundles, device data in image and document metadata (a display
 * profile's serial number, EXIF, XMP and IPTC makes, models, serial numbers,
 * authors and positions, a PDF's author, a video's recorded place), wherever an
 * image sits, data too large or in a form the scanner cannot read, which it
 * reports rather than skips, and the login, short host name and Git e-mail address of
 * the machine that runs the scan, which nobody has to write down for it, plus
 * the names PRIVACY_NAMES lists (a CI secret can hold them, since a runner's
 * own names identify nobody). The scanner and its policy are
 * tests/privacy/scan.mjs, which the site carries byte for byte as
 * scripts/privacy-scan.mjs; its header lists every rule that allows something
 * and why, and check.test.mjs exercises each one.
 *
 * This repository adds one rule of its own: the vendored upstream files in
 * VENDORED_NOTICES, whose license header names their authors as the license
 * requires.
 *
 * A finding prints its file, line and category, never the matched text, so the
 * gate's own output cannot leak what it found.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GENERIC_ACCOUNTS, localMachineNames as localNames, machineNames, placeholderUser, scanFile as scanWith, scanRepository as scanTree,
} from './scan.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export { GENERIC_ACCOUNTS, machineNames, placeholderUser };

/** Vendored upstream code whose license header names its authors, as the license requires. */
export const VENDORED_NOTICES = new Map([
  ['packages/extension-table/src/helpers/pasteCells.ts', 'the MIT notice of the prosemirror-tables code it adapts'],
]);

/** This machine's names and the listed ones, read where they live. */
export const localMachineNames = (env = process.env) => localNames(repoRoot, env);

/** Findings in one file, as { path, location, line, category }. */
export const scanFile = (path, bytes, names) => scanWith(path, bytes, names, { notices: VENDORED_NOTICES });

/** Findings over a repository. */
export function scanRepository(root = repoRoot, { names = localMachineNames(), files } = {}) {
  return scanTree(root, { names, ...(files ? { files } : {}), notices: VENDORED_NOTICES });
}

/** CLI: print findings as location:line category and set the exit code. */
export function main({ root = repoRoot, names, files, log = console.log, error = console.error } = {}) {
  const { scanned, findings } = scanRepository(root, { ...(names ? { names } : {}), ...(files ? { files } : {}) });
  if (findings.length > 0) {
    error('[privacy] FAILED: personal data in tracked files (the matched text is not printed):');
    for (const finding of findings) error(`  - ${finding.location}:${finding.line} ${finding.category}`);
    error('[privacy] replace it with a placeholder such as $HOME, a reserved domain such as example.com, or a rule in tests/privacy/scan.mjs with its reason; in image metadata, clear the serial number or strip the metadata, keeping the pixels; unscanned data is too large or in a form the scanner cannot read, so make it smaller or store it plainly');
    return 1;
  }
  log(`[privacy] OK: ${scanned} tracked files hold no e-mail address, home, drive or network path, file URL, device data in image or document metadata, unscanned data or name of this machine outside the documented rules`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
