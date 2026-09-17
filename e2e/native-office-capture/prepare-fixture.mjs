#!/usr/bin/env node
/**
 * Prepare a claimed native fixture for review: hash the source document and the capture bundle,
 * check the bundle's integrity, and write a manifest skeleton whose `expected` outputs are empty.
 * `offline.mjs` refuses that skeleton until a reviewer authors both expected outputs against the
 * content specification. Expected outputs are never copied from normalizer output here.
 */
import { createHash } from 'node:crypto';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { HARD_LIMITS, TEXT_FORMATS } from './capture.mjs';
import { disposeCaptureEvidence, validateCaptureBytes } from './offline.mjs';
import { imageInventory } from './semantics.mjs';

const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const DEFAULT_LICENSE = 'MIT; synthetic document authored for Domternal paste qualification, reviewed for personal and hidden data';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function readInside(root, name, maximum) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(name)) throw new Error('Artifact names are plain file names inside the fixture directory');
  const path = await realpath(join(root, name));
  const inside = relative(root, path);
  if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error('Artifact escapes the fixture directory');
  const info = await stat(path);
  if (!info.isFile() || info.size > maximum) throw new Error('Artifact is not a regular file within its size limit');
  return readFile(path);
}

/** Write `manifest.json` and `capture-summary.json` for review. Existing files are never replaced. */
export async function prepareFixture(directory, { id, source, capture, license = DEFAULT_LICENSE }) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,127}$/u.test(id)) throw new Error('Fixture id must be lowercase letters, digits, dots and hyphens');
  const root = await realpath(directory);
  const sourceBytes = await readInside(root, source, MAX_SOURCE_BYTES);
  const captureBytes = await readInside(root, capture, HARD_LIMITS.maxJSONBytes);
  const sourceSha256 = digest(sourceBytes);
  const captureSha256 = digest(captureBytes);
  // Integrity first: a complete bundle, a native event claim and the same source hash.
  const { handle, report } = validateCaptureBytes(captureBytes, { captureSha256, fixtureSha256: sourceSha256, fixtureId: id, origin: 'claimed-native' });
  disposeCaptureEvidence(handle);
  const bundle = JSON.parse(captureBytes.toString('utf8'));
  const manifest = {
    schemaVersion: 1, id, origin: 'claimed-native', license,
    source: { path: source, sha256: sourceSha256 }, capture: { path: capture, sha256: captureSha256 },
    // Author preserve and adapt against the content specification after review; offline.mjs refuses null.
    expected: null,
  };
  const summary = {
    kind: 'native-capture-review-summary', fixtureId: id, qualification: false, reviewed: false,
    operator: bundle.operator, capturedAt: bundle.capturedAt, claimedEventKind: report.claimedEventKind,
    availableFormats: bundle.payload.availableFormats,
    // Flavor sizes are large-paste evidence: PasteCleanup rejects any flavor above its input ceiling.
    formatUnits: Object.fromEntries(TEXT_FORMATS.filter(format => typeof bundle.payload.text[format] === 'string')
      .map(format => [format, bundle.payload.text[format].length])),
    // Image references by URL scheme, without addresses: the Google Docs image scenarios count them.
    htmlImages: typeof bundle.payload.text['text/html'] === 'string' ? imageInventory(bundle.payload.text['text/html']) : null,
    textBytes: report.textBytes, fileBytes: report.fileBytes, itemCount: report.itemCount, fileCount: report.fileCount,
    review: [
      'Open the source document and confirm it contains no personal, customer or hidden data.',
      'Author expected.preserve and expected.adapt from the content specification, then compare them with the replay.',
      'Record every unsupported or missing representation as it is; do not edit the capture bundle.',
    ],
  };
  await writeFile(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await writeFile(join(root, 'capture-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
  return Object.freeze({ manifest, summary });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    id: { type: 'string' }, source: { type: 'string' }, capture: { type: 'string', default: 'capture.json' }, license: { type: 'string' },
  } });
  try {
    if (positionals.length !== 1 || !values.id || !values.source) throw new Error('Usage: node prepare-fixture.mjs <fixture-dir> --id <id> --source <source.docx> [--capture capture.json]');
    const { summary } = await prepareFixture(resolve(positionals[0]), values);
    process.stdout.write(`${JSON.stringify({ prepared: true, formatUnits: summary.formatUnits }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.code ?? error?.message ?? 'prepare-failed'}\n`);
    process.exitCode = 1;
  }
}
