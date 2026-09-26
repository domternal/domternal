/**
 * Declared redactions of committed evidence.
 *
 * Evidence written on a developer's machine records the paths it ran with,
 * and some of those name the machine's home folder, and so its account name.
 * The one rule here, R1, replaces them without recording what they were:
 *
 * - a session scratchpad directory, `/private/tmp/claude-<uid>/<project>/
 *   <session uuid>/scratchpad`, becomes `$SCRATCHPAD`;
 * - a home folder, `/Users/<account>` or `/home/<account>`, becomes `$HOME`.
 *
 * Both placeholders are literal shell variables, so a recorded command stays
 * meaningful, and both are ASCII, so every serializer writes them unescaped.
 * The rule holds no value: it reads the same on every machine, and applying it
 * twice changes nothing.
 *
 * A historical-tools MANIFEST.json of version 2 declares each redaction it
 * applied (see `checkRedactions`): the files it changed with their redacted
 * size and digest and the number of placeholders each holds, the commit that
 * still holds the unredacted bytes, and every digest the redaction replaced or
 * withheld. A digest of unredacted bytes is never recorded, because it would
 * confirm a guessed account name offline. `historyProblems` proves, locally,
 * that the committed bytes are the unredacted ones with only R1 and those
 * digests applied.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { getPointer, parseJson, sha256 } from './json.mjs';

export const HOME_PLACEHOLDER = '$HOME';
export const SCRATCHPAD_PLACEHOLDER = '$SCRATCHPAD';
export const PLACEHOLDERS = [HOME_PLACEHOLDER, SCRATCHPAD_PLACEHOLDER];

/** The rule as a manifest declares it. */
export const RULE = Object.freeze([
  Object.freeze({ replaces: "the producing machine's home folder", with: HOME_PLACEHOLDER }),
  Object.freeze({ replaces: 'the session scratchpad directory', with: SCRATCHPAD_PLACEHOLDER }),
]);

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SCRATCHPAD_PATH = new RegExp(`/private/tmp/claude-\\d+/[^/\\s"'\`<>]+/${UUID}/scratchpad`, 'g');
// Not inside a URL path or a longer name: the folder starts a path.
const HOME_PATH = /(?<![\w.~-])\/(?:Users|home)\/[A-Za-z0-9._-]+/g;
const PLACEHOLDER_TOKEN = /\$(?:HOME|SCRATCHPAD)(?![A-Za-z0-9_])/g;

/** R1: a text with every scratchpad and home folder path replaced by its placeholder. */
export function redactPaths(text) {
  return text.replace(SCRATCHPAD_PATH, () => SCRATCHPAD_PLACEHOLDER).replace(HOME_PATH, () => HOME_PLACEHOLDER);
}

/** R1 over bytes read as UTF-8; bytes it leaves alone are returned as they are. */
export function redactBytes(data) {
  const text = data.toString('utf8');
  const redacted = redactPaths(text);
  return redacted === text ? data : Buffer.from(redacted, 'utf8');
}

/** Whether a text still holds a path R1 replaces. */
export function holdsPersonalPath(text) {
  return redactPaths(text) !== text;
}

/** How many placeholders a text holds. */
export function countPlaceholders(text) {
  return [...text.matchAll(PLACEHOLDER_TOKEN)].length;
}

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REDACTION_KEYS = new Set(['id', 'date', 'reason', 'rule', 'files', 'digestsReplaced', 'digestsWithheld']);
const FILE_KEYS = new Set(['path', 'occurrences', 'redactedSha256', 'redactedBytes', 'originalIn']);
const RULE_KEYS = new Set(['replaces', 'with']);
export const WITHHELD = 'withheld';

const unknownKeys = (value, allowed) => Object.keys(value).filter((key) => !allowed.has(key));

/** Digests recorded in Markdown as "- Label: `hex`", by label. */
function markdownLabels(text) {
  const found = new Map();
  for (const match of text.matchAll(/^- ([^:\n]+): `([0-9a-f]{64})`$/gm)) found.set(match[1], match[2]);
  return found;
}

/**
 * A reference `<path relative to the manifest>#<fragment>`: a JSON pointer in
 * a JSON file, or a digest label in a Markdown file.
 */
export function resolveReference(root, directory, reference) {
  if (typeof reference !== 'string' || !reference.includes('#')) return { problem: `reference ${JSON.stringify(reference)} is not <file>#<pointer or label>` };
  const hash = reference.indexOf('#');
  const relative = reference.slice(0, hash);
  const fragment = reference.slice(hash + 1);
  const path = posix.normalize(posix.join(directory, relative));
  if (path.startsWith('..') || posix.isAbsolute(path)) return { problem: `reference ${reference} leaves the repository` };
  const full = join(root, path);
  if (!existsSync(full)) return { problem: `reference ${reference} names a missing file` };
  const text = readFileSync(full, 'utf8');
  if (path.endsWith('.md')) {
    const labels = markdownLabels(text);
    return labels.has(fragment) ? { path, value: labels.get(fragment) } : { problem: `reference ${reference} names no digest label` };
  }
  let value;
  try {
    value = getPointer(parseJson(Buffer.from(text, 'utf8')), fragment);
  } catch (error) {
    return { problem: `reference ${reference} cannot be read (${error.message})` };
  }
  return value === undefined ? { problem: `reference ${reference} names nothing` } : { path, value };
}

/**
 * Every file the version 2 manifests declare, by repository path, with the
 * manifest directory and redaction that declare it.
 */
export function declaredFiles(declarations) {
  const files = new Map();
  for (const { directory, manifest } of declarations) {
    for (const redaction of Array.isArray(manifest.redactions) ? manifest.redactions : []) {
      for (const file of Array.isArray(redaction.files) ? redaction.files : []) {
        if (typeof file?.path !== 'string') continue;
        const path = posix.normalize(posix.join(directory, file.path));
        if (!files.has(path)) files.set(path, { directory, redaction, file });
      }
    }
  }
  return files;
}

/**
 * Problems with the redactions one version 2 manifest declares. `all` is every
 * declared file of every manifest, so a replaced digest may name a file
 * another manifest declares.
 */
export function checkRedactions(root, directory, manifest, all) {
  const problems = [];
  const say = (message) => problems.push(`${directory}: ${message}`);
  const redactions = manifest.redactions;
  if (!Array.isArray(redactions) || redactions.length === 0) {
    say('a version 2 MANIFEST.json must declare its redactions');
    return problems;
  }
  const redactedDigests = new Set([...all.values()].map(({ file }) => file.redactedSha256));
  const ids = new Set();
  // The declarations name the placeholders themselves; a change is one elsewhere in the manifest.
  let changesSomething = countPlaceholders(JSON.stringify({ ...manifest, redactions: [] })) > 0;
  for (const [index, redaction] of redactions.entries()) {
    const where = `redactions[${index}]`;
    if (redaction === null || typeof redaction !== 'object' || Array.isArray(redaction)) {
      say(`${where} is not an object`);
      continue;
    }
    for (const key of unknownKeys(redaction, REDACTION_KEYS)) say(`${where} has an unknown key ${key}`);
    if (typeof redaction.id !== 'string' || !/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(redaction.id) || ids.has(redaction.id)) say(`${where} needs a unique id such as 2026-10-03-home-paths`);
    ids.add(redaction.id);
    if (typeof redaction.date !== 'string' || !DATE.test(redaction.date)) say(`${where} needs a date`);
    if (typeof redaction.reason !== 'string' || redaction.reason.trim() === '') say(`${where} needs a reason`);
    const rule = Array.isArray(redaction.rule) ? redaction.rule : [];
    if (rule.length === 0) say(`${where} needs its rule`);
    for (const step of rule) {
      if (step === null || typeof step !== 'object') {
        say(`${where} has a rule step that is not an object`);
        continue;
      }
      for (const key of unknownKeys(step, RULE_KEYS)) say(`${where} rule has an unknown key ${key}`);
      if (!PLACEHOLDERS.includes(step.with) || typeof step.replaces !== 'string' || step.replaces === '') say(`${where} rule must replace a described value by $HOME or $SCRATCHPAD`);
    }
    const files = Array.isArray(redaction.files) ? redaction.files : null;
    if (!files) say(`${where} needs a files list`);
    for (const file of files ?? []) {
      if (file === null || typeof file !== 'object') {
        say(`${where} lists a file that is not an object`);
        continue;
      }
      for (const key of unknownKeys(file, FILE_KEYS)) say(`${where} file ${String(file.path)} has an unknown key ${key}`);
      if (typeof file.path !== 'string') {
        say(`${where} lists a file without a path`);
        continue;
      }
      const path = posix.normalize(posix.join(directory, file.path));
      if (path.startsWith('..') || posix.isAbsolute(path)) {
        say(`${where} file ${file.path} leaves the repository`);
        continue;
      }
      if (all.get(path)?.file !== file) say(`${path} is declared by more than one redaction`);
      if (!Number.isSafeInteger(file.occurrences) || file.occurrences < 0) say(`${where} file ${path} needs its count of placeholders`);
      if (!SHA256.test(file.redactedSha256 ?? '') || !Number.isSafeInteger(file.redactedBytes)) say(`${where} file ${path} needs its redacted size and digest`);
      if (typeof file.originalIn !== 'string' || !COMMIT.test(file.originalIn)) say(`${where} file ${path} needs the commit that holds its unredacted bytes`);
      const full = join(root, path);
      if (!existsSync(full)) {
        say(`${where} declares ${path}, which is missing`);
        continue;
      }
      const data = readFileSync(full);
      const text = data.toString('utf8');
      changesSomething = true;
      if (data.length !== file.redactedBytes || sha256(data) !== file.redactedSha256) {
        say(`${path} is not the redacted file declared in ${where} (${data.length} bytes, sha256 ${sha256(data)})`);
      }
      if (countPlaceholders(text) !== file.occurrences) say(`${path} holds ${countPlaceholders(text)} placeholders, ${where} declares ${String(file.occurrences)}`);
      if (holdsPersonalPath(text)) say(`${path} still holds a path the redaction replaces`);
    }
    for (const reference of Array.isArray(redaction.digestsReplaced) ? redaction.digestsReplaced : [null]) {
      const resolved = resolveReference(root, directory, reference);
      if (resolved.problem) say(`${where} digestsReplaced: ${resolved.problem}`);
      else if (!redactedDigests.has(resolved.value)) say(`${where} digestsReplaced: ${reference} is not the redacted digest of a declared file`);
    }
    for (const reference of Array.isArray(redaction.digestsWithheld) ? redaction.digestsWithheld : [null]) {
      const resolved = resolveReference(root, directory, reference);
      if (resolved.problem) say(`${where} digestsWithheld: ${resolved.problem}`);
      // A digest field holds the word itself; a sentence that quoted a digest says it is withheld.
      else if (typeof resolved.value !== 'string' || !resolved.value.includes(WITHHELD) || /[0-9a-f]{64}/.test(resolved.value)) {
        say(`${where} digestsWithheld: ${reference} must hold "${WITHHELD}" in place of the digest`);
      }
    }
  }
  if (!changesSomething) say('the declared redactions change no file and leave no placeholder in MANIFEST.json');
  return problems;
}

/**
 * Evidence files that hold a placeholder no manifest declares. A version 2
 * MANIFEST.json declares the placeholders in its own text.
 */
export function undeclaredPlaceholders(root, files, all, manifestsWithRedactions) {
  const problems = [];
  for (const path of files) {
    const full = join(root, path);
    if (!existsSync(full) || all.has(path) || manifestsWithRedactions.has(path)) continue;
    const data = readFileSync(full);
    if (data.includes(0)) continue;
    if (countPlaceholders(data.toString('utf8')) > 0) problems.push(`${path}: holds $HOME or $SCRATCHPAD, but no MANIFEST.json declares a redaction of it`);
  }
  return problems;
}

/** Read a file as committed at a revision, or null when Git cannot show it. */
export function gitShowOrNull(root, revision, path) {
  try {
    return execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/**
 * The unredacted bytes of a declared file as the redaction turns them into
 * the committed ones: R1, then every digest and size of a declared original
 * replaced by its redacted counterpart.
 */
export function applyDeclaredRedaction(original, mapping) {
  let text = redactPaths(original.toString('utf8'));
  for (const { originalSha256, redactedSha256, originalBytes, redactedBytes } of mapping) {
    text = text.split(originalSha256).join(redactedSha256);
    // A record writes its size right before its digest: {..., "bytes": n, "sha256": "..."}.
    text = text.replace(new RegExp(`("bytes": )${originalBytes}(,\\s*"sha256": "${redactedSha256}")`, 'g'), `$1${redactedBytes}$2`);
  }
  return Buffer.from(text, 'utf8');
}

/**
 * The local history check: for every declared file whose unredacted bytes Git
 * still holds, the committed bytes are exactly those with the declared
 * redaction applied. An original Git no longer has, as in a shallow clone or
 * after a history rewrite, is reported as unavailable, not as a failure.
 */
export function historyProblems(root, all, { show = (revision, path) => gitShowOrNull(root, revision, path) } = {}) {
  const problems = [];
  const unavailable = [];
  const originals = new Map();
  for (const [path, { file }] of all) {
    const original = typeof file.originalIn === 'string' ? show(file.originalIn, path) : null;
    if (original === null) unavailable.push(`${path}: the original at ${String(file.originalIn)} is not available, so only the declaration was checked`);
    else originals.set(path, original);
  }
  const mapping = [];
  for (const [path, original] of originals) {
    const committed = readFileSync(join(root, path));
    if (!original.equals(committed)) {
      mapping.push({ originalSha256: sha256(original), redactedSha256: sha256(committed), originalBytes: original.length, redactedBytes: committed.length });
    }
  }
  for (const [path, original] of originals) {
    if (unavailable.length > 0) break;
    const committed = readFileSync(join(root, path));
    if (!applyDeclaredRedaction(original, mapping).equals(committed)) {
      problems.push(`${path}: the committed bytes are not the original at ${all.get(path).file.originalIn} with only the declared redaction applied`);
    }
  }
  if (unavailable.length > 0 && originals.size > 0) unavailable.push('the declared files were not compared, because a digest of an unavailable original cannot be mapped');
  return { problems, unavailable, compared: unavailable.length > 0 ? 0 : originals.size };
}
