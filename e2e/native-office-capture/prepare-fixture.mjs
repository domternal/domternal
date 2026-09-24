#!/usr/bin/env node
/**
 * Prepare a claimed native fixture for review: hash the source document and the capture bundle,
 * check the bundle's integrity and any declared redaction, and write a version 2 manifest skeleton.
 * With a content specification and scenario, its `expected` holds the blocks that scenario authors;
 * the outcome of each policy stays empty. `offline.mjs` refuses the skeleton until a reviewer authors
 * both outcomes. Expected outputs are never copied from normalizer output here.
 */
import { createHash } from 'node:crypto';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { HARD_LIMITS, TEXT_FORMATS } from './capture.mjs';
import { checkRedactionPairing, disposeCaptureEvidence, readRedactions, validateCaptureBytes, verifyCaptureRedaction, verifyPackageRedaction } from './offline.mjs';
import { expectedBlocks, imageInventory } from './semantics.mjs';
import { scanFiles } from './privacy.mjs';

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

/** The blocks a content specification authors for one scenario, as the manifest's semantic oracle holds them. */
export function specifiedExpectation(specification, scenarioId) {
  const { scenario } = expectedBlocks(specification, scenarioId);
  const blocks = new Map(specification.documents.flatMap(document => document.blocks.map(block => [block.id, block])));
  return {
    specification: specification.id, scenario: scenario.id,
    ...(scenario.partial === undefined ? {} : { partial: scenario.partial }),
    blocks: scenario.blocks.map(id => blocks.get(id)),
    // The reviewer authors each policy's outcome from the specification and the reviewed editor results.
    preserve: null, adapt: null,
  };
}

/** Write `manifest.json` and `capture-summary.json` for review. Existing files are never replaced. */
export async function prepareFixture(directory, { id, source, capture, license = DEFAULT_LICENSE, redactions, specification, scenario }) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,127}$/u.test(id)) throw new Error('Fixture id must be lowercase letters, digits, dots and hyphens');
  if ((specification === undefined) !== (scenario === undefined)) throw new Error('Name both the content specification and its scenario, or neither');
  const root = await realpath(directory);
  const sourceBytes = await readInside(root, source, MAX_SOURCE_BYTES);
  const captureBytes = await readInside(root, capture, HARD_LIMITS.maxJSONBytes);
  const sourceSha256 = digest(sourceBytes);
  const captureSha256 = digest(captureBytes);
  // Declared redactions, written by redact.mjs into the fixture directory, are checked like offline.mjs checks them.
  const declarations = redactions === undefined ? [] : JSON.parse((await readInside(root, redactions, 128 * 1024)).toString('utf8'));
  const declared = checkRedactionPairing(readRedactions(declarations));
  if ((declared.source !== undefined && declared.source.redactedSha256 !== sourceSha256)
    || (declared.capture !== undefined && declared.capture.redactedSha256 !== captureSha256)) throw new Error('A declared redaction does not describe the files in the fixture directory');
  // Integrity first: a complete bundle, a native event claim and the source it names, withheld when that source was redacted.
  const { handle, report } = validateCaptureBytes(captureBytes, { captureSha256, fixtureSha256: declared.source === undefined ? sourceSha256 : null, fixtureId: id, origin: 'claimed-native' });
  disposeCaptureEvidence(handle);
  const bundle = JSON.parse(captureBytes.toString('utf8'));
  if (declared.source !== undefined) verifyPackageRedaction(sourceBytes, declared.source);
  verifyCaptureRedaction(bundle, declared.capture);
  // Nothing personal is admitted: what the scan finds is redacted with redact.mjs first.
  const findings = await scanFiles([join(root, source), join(root, capture)]);
  if (findings.length > 0) {
    throw new Error(`Personal data found; redact it first: ${findings.slice(0, 16).map(entry => `${entry.category} in ${relative(root, entry.location)} at ${String(entry.offset)}`).join('; ')}`);
  }
  const manifest = {
    schemaVersion: 2, id, origin: 'claimed-native', license,
    source: { path: source, sha256: sourceSha256 }, capture: { path: capture, sha256: captureSha256 },
    redactions: declarations,
    // Author preserve and adapt against the content specification after review; offline.mjs refuses null.
    expected: scenario === undefined ? null : specifiedExpectation(specification, scenario),
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
    // What each redaction changed and why, by location only: the removed values are not recorded anywhere.
    redactions: declarations.map(entry => ({ artifact: entry.artifact, basis: entry.basis, originalRetained: entry.originalRetained, reason: entry.reason,
      changes: entry.artifact === 'source' ? entry.clearedElements : entry.replacements.map(({ flavor, offset, length }) => ({ flavor, offset, length })),
      ...(entry.artifact === 'capture' ? { withheld: entry.withheld } : {}) })),
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
    redactions: { type: 'string' }, specification: { type: 'string' }, scenario: { type: 'string' },
  } });
  try {
    if (positionals.length !== 1 || !values.id || !values.source) {
      throw new Error('Usage: node prepare-fixture.mjs <fixture-dir> --id <id> --source <source.docx> [--capture capture.json] [--redactions redactions.json] [--specification <content.json> --scenario <id>]');
    }
    const specification = values.specification === undefined ? undefined : JSON.parse(await readFile(resolve(values.specification), 'utf8'));
    const { summary } = await prepareFixture(resolve(positionals[0]), { ...values, specification });
    process.stdout.write(`${JSON.stringify({ prepared: true, formatUnits: summary.formatUnits }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.code ?? error?.message ?? 'prepare-failed'}\n`);
    process.exitCode = 1;
  }
}
