/**
 * Artifact records and the input manifest every evidence command reads from.
 *
 * Evidence names each raw file it relied on by the path it had when the run
 * happened (`originalPath`, usually under `/private/tmp`), with its size and
 * SHA-256. Those paths do not survive a reboot, so the tool never reads them
 * implicitly: every byte comes through an `inputs.json` manifest that maps each
 * original path to where its bytes live now, and every read is checked against
 * the recorded size and digest. A file whose bytes were never preserved is
 * listed as lost with its recorded digest, and only the callers that can
 * honestly work with a recorded digest accept it.
 *
 * Manifest shape (`kind: domternal-evidence-inputs`, `version: 1`):
 *
 *   { unit, files: [{ role, originalPath, bytes, sha256, source }] }
 *
 * where `source` is one of `{ kind: 'file', path }`, `{ kind: 'git',
 * repository, revision, path }` or `{ kind: 'lost' }`. A file or Git source
 * may add `redaction: <id>`: its bytes are read through the declared
 * redaction R1 (redaction.mjs), and the recorded size and digest are those of
 * the redacted bytes, as the committed evidence records them. An original
 * path may start with `$HOME/` or `$SCRATCHPAD/`, as redacted evidence
 * records it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parseJson, pythonReadText, sha256 } from './json.mjs';
import { LOST } from './inventory.mjs';
import { EvidenceCheckError, ensure } from './playwright.mjs';
import { redactBytes, redactPaths } from './redaction.mjs';

/** An absolute path, or one a declared redaction rooted at a placeholder. */
const recordedPath = (path) => typeof path === 'string' && (isAbsolute(path) || /^\$(?:HOME|SCRATCHPAD)\//.test(path));

export const INPUTS_KIND = 'domternal-evidence-inputs';

/** `{role, localPath, bytes, sha256}`, the key order the Python originals wrote. */
export function artifactRecord(role, localPath, data) {
  return { role, localPath, bytes: data.length, sha256: sha256(data) };
}

function readGitObject(source) {
  return execFileSync('git', ['show', `${source.revision}:${source.path}`], {
    cwd: source.repository,
    maxBuffer: 1 << 30,
  });
}

/**
 * The files one evidence command may read, each checked on every read.
 * Reading a path the manifest does not list is an error, never a fallback to
 * the file system.
 */
export class InputSet {
  constructor(manifest) {
    ensure(manifest?.kind === INPUTS_KIND && manifest.version === 1, 'Not an evidence inputs manifest');
    ensure(Array.isArray(manifest.files), 'Inputs manifest has no files');
    this.unit = manifest.unit;
    this.files = new Map();
    this.cache = new Map();
    for (const file of manifest.files) {
      ensure(recordedPath(file.originalPath), 'Input without an absolute original path');
      ensure(file.source?.redaction === undefined || (typeof file.source.redaction === 'string' && file.source.kind !== 'lost'), 'Input with an invalid redaction', file.originalPath);
      ensure(!this.files.has(file.originalPath), 'Duplicate input', file.originalPath);
      ensure(Number.isSafeInteger(file.bytes) && /^[0-9a-f]{64}$/.test(file.sha256), 'Input without a recorded size and digest', file.originalPath);
      ensure(['file', 'git', 'lost'].includes(file.source?.kind), 'Input without a known source', file.originalPath);
      this.files.set(file.originalPath, file);
    }
  }

  static load(path) {
    return new InputSet(parseJson(readFileSync(path)));
  }

  has(originalPath) {
    return this.files.has(originalPath);
  }

  entry(originalPath) {
    const file = this.files.get(originalPath);
    if (!file) throw new EvidenceCheckError('Input missing from inputs.json', originalPath);
    return file;
  }

  isLost(originalPath) {
    return this.entry(originalPath).source.kind === 'lost';
  }

  /** The verified bytes, or `LOST` for a file that was never preserved. */
  readOrLost(originalPath) {
    const file = this.entry(originalPath);
    if (file.source.kind === 'lost') return LOST;
    if (this.cache.has(originalPath)) return this.cache.get(originalPath);
    let data;
    if (file.source.kind === 'git') data = readGitObject(file.source);
    else {
      ensure(existsSync(file.source.path), 'Input source file missing', `${originalPath} at ${file.source.path}`);
      data = readFileSync(file.source.path);
    }
    if (file.source.redaction !== undefined) data = redactBytes(data);
    ensure(data.length === file.bytes && sha256(data) === file.sha256, 'Input digest mismatch', originalPath);
    this.cache.set(originalPath, data);
    return data;
  }

  /** The verified bytes; a lost input is an error here. */
  read(originalPath) {
    const data = this.readOrLost(originalPath);
    if (data === LOST) throw new EvidenceCheckError('Input bytes were not preserved', originalPath);
    return data;
  }

  readText(originalPath) {
    return pythonReadText(this.read(originalPath));
  }

  readJson(originalPath) {
    return parseJson(this.read(originalPath));
  }

  /** Input paths directly inside a directory, as a Python `glob('*.ext')` lists them. */
  listDirectory(directory, suffix) {
    const prefix = directory.endsWith('/') ? directory : `${directory}/`;
    return [...this.files.keys()].filter((path) => {
      if (!path.startsWith(prefix)) return false;
      const name = path.slice(prefix.length);
      return !name.includes('/') && name.endsWith(suffix);
    });
  }
}

/**
 * An inputs manifest for files that still exist where they were recorded,
 * used at capture time before anything has been archived.
 */
export function inputsFromFileSystem(unit, paths) {
  return {
    kind: INPUTS_KIND,
    version: 1,
    unit,
    files: paths.map(({ role, originalPath }) => {
      const data = readFileSync(originalPath);
      return { role, originalPath, bytes: data.length, sha256: sha256(data), source: { kind: 'file', path: originalPath } };
    }),
  };
}

/** The durable archive: `index.json` plus content-addressed `blobs/`. */
export class EvidenceArchive {
  constructor(directory) {
    const indexPath = join(directory, 'index.json');
    ensure(existsSync(indexPath), 'Evidence archive index missing', indexPath);
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    ensure(index.kind === 'domternal-evidence-archive-index' && Array.isArray(index.entries), 'Not a Domternal evidence archive', directory);
    this.directory = directory;
    this.index = index;
    this.byPath = new Map(index.entries.map((entry) => [entry.originalPath, entry]));
    // Redacted evidence names an archived file by its path with R1 applied.
    for (const entry of index.entries) {
      const redacted = redactPaths(entry.originalPath);
      if (redacted !== entry.originalPath && !this.byPath.has(redacted)) this.byPath.set(redacted, entry);
    }
    this.blobs = new Set(readdirSync(join(directory, 'blobs')));
  }

  blobPath(digest) {
    return this.blobs.has(digest) ? join(this.directory, 'blobs', digest) : null;
  }

  /** The archived entry recorded at `originalPath`. */
  entry(originalPath) {
    return this.byPath.get(originalPath) ?? null;
  }

  /** Archived entries directly inside `directory` whose names end with `suffix`, by original or redacted path. */
  entriesIn(directory, suffix) {
    const prefix = directory.endsWith('/') ? directory : `${directory}/`;
    return this.index.entries.filter((entry) => {
      const path = entry.originalPath.startsWith(prefix) ? entry.originalPath : redactPaths(entry.originalPath);
      if (!path.startsWith(prefix)) return false;
      const name = path.slice(prefix.length);
      return !name.includes('/') && name.endsWith(suffix);
    });
  }
}

/**
 * Find recorded bytes in Git history: every version of `path` on any ref,
 * newest first, until one has the recorded digest.
 */
export function findInGitHistory(repository, path, digest) {
  let revisions;
  try {
    revisions = execFileSync('git', ['log', '--all', '--format=%H', '--', path], { cwd: repository, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    return null;
  }
  const seen = new Set();
  for (const revision of revisions) {
    let blob;
    try {
      blob = execFileSync('git', ['rev-parse', `${revision}:${path}`], { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      continue;
    }
    if (seen.has(blob)) continue;
    seen.add(blob);
    const data = execFileSync('git', ['cat-file', 'blob', blob], { cwd: repository, maxBuffer: 1 << 30 });
    if (sha256(data) === digest) return { kind: 'git', repository, revision, path };
  }
  return null;
}

/**
 * Where the recorded bytes of one file live now, in the order the replay
 * design fixes: an archive blob with that digest, then a Git object with that
 * digest anywhere in history, else lost. Nothing is guessed.
 */
export function locateRecordedBytes({ archive, repository, relativePath, digest }) {
  const blob = archive?.blobPath(digest);
  if (blob) return { kind: 'file', path: blob };
  if (repository && relativePath) {
    const found = findInGitHistory(repository, relativePath, digest);
    if (found) return found;
  }
  return { kind: 'lost' };
}
