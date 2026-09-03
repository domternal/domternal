/**
 * Frozen source and build inventories: which repository files a qualification
 * ran against, with their sizes and SHA-256 digests.
 *
 * A snapshot is taken before a browser run and checked again after it, so the
 * evidence names the exact bytes it qualified. Membership is not a hand-kept
 * list: selection rules, held as data by each unit, decide which files belong,
 * and the check rebuilds the membership from them. The same rules run over
 * three kinds of tree:
 *
 * - the live repository, at capture time (`listCandidates`);
 * - the stored inventory itself, in replay, which proves every row is justified
 *   by a rule and every fixed file is present;
 * - the Git tree at the recorded head plus the recorded untracked files, in
 *   replay, which independently rebuilds every category Git tracks. Build
 *   output is ignored by Git, so its membership can only be taken from the
 *   stored list, and the result says so.
 *
 * Rows and digests are byte-compatible with the Python originals:
 * `{path, bytes, sha256}` in that key order, sorted by path in code point order,
 * digested as canonical JSON.
 */
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, statSync, writeSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { canonicalBytes, codePointCompare, indentedBytes, pythonUtcIsoformat, sha256 } from './json.mjs';
import { EvidenceCheckError, ensure } from './playwright.mjs';

const SHA256 = /^[0-9a-f]{64}$/;

/** A repository-relative path that cannot leave the root. */
export function isSafeRelativePath(path) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !isAbsolute(path) &&
    !path.includes('\\') &&
    !path.split('/').some((part) => part === '' || part === '.' || part === '..')
  );
}

function segmentPattern(segment) {
  return segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
}

/**
 * A glob as a RegExp over repository-relative file paths. `*` matches within
 * one segment (dotfiles included, as `pathlib` matches them) and a final `**`
 * matches every file below.
 */
export function globToRegExp(pattern) {
  const segments = pattern.split('/');
  const parts = segments.map((segment, index) => {
    if (segment !== '**') return segmentPattern(segment);
    if (index !== segments.length - 1) throw new Error(`Only a final ** is supported: ${pattern}`);
    return '.+';
  });
  return new RegExp(`^${parts.join('/')}$`);
}

function directMatcher(rule) {
  const prefix = `${rule.dir}/`;
  return (path) => {
    if (!path.startsWith(prefix)) return false;
    const name = path.slice(prefix.length);
    if (name.includes('/') || name.startsWith('.')) return false;
    const dot = name.lastIndexOf('.');
    return dot > 0 && rule.suffixes.includes(name.slice(dot));
  };
}

function matcherFor(rule) {
  if (rule.kind === 'glob') {
    const expression = globToRegExp(rule.pattern);
    return (path) => expression.test(path);
  }
  if (rule.kind === 'direct') return directMatcher(rule);
  throw new Error(`Unknown selection rule kind: ${rule.kind}`);
}

function validateRules(rules) {
  for (const rule of rules) {
    if (rule.kind === 'files') {
      for (const path of rule.paths) ensure(isSafeRelativePath(path), 'Unsafe selection path', path);
    } else if (rule.kind === 'glob') {
      ensure(isSafeRelativePath(rule.pattern.replace(/\*/g, 'x')), 'Unsafe selection pattern', rule.pattern);
    } else if (rule.kind === 'direct') {
      ensure(isSafeRelativePath(rule.dir), 'Unsafe selection directory', rule.dir);
    } else {
      throw new Error(`Unknown selection rule kind: ${rule.kind}`);
    }
  }
}

/** Sort paths the way `sorted(..., key=str)` does in Python. */
export function sortPaths(paths) {
  return [...paths].sort(codePointCompare);
}

/**
 * Apply the rules to the files of a tree. Fixed files are selected whether or
 * not the tree has them, as the Python `selected()` did; `missingFiles` names
 * the ones it lacks.
 */
export function selectFromCandidates(rules, candidates) {
  validateRules(rules);
  const present = new Set(candidates);
  const selected = new Set();
  const missingFiles = [];
  for (const rule of rules) {
    if (rule.kind === 'files') {
      for (const path of rule.paths) {
        selected.add(path);
        if (!present.has(path)) missingFiles.push(path);
      }
      continue;
    }
    const matches = matcherFor(rule);
    for (const path of present) if (matches(path)) selected.add(path);
  }
  return { selected: sortPaths(selected), missingFiles: sortPaths(new Set(missingFiles)) };
}

function insideRoot(realRoot, path) {
  const offset = relative(realRoot, path);
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset));
}

/** Whether a directory entry counts as a file, as `Path.is_file()` answers. */
function entryIsFile(root, realRoot, rel) {
  const full = join(root, rel);
  const stat = lstatSync(full, { throwIfNoEntry: false });
  if (!stat) return false;
  if (stat.isSymbolicLink()) {
    const target = realpathSync(full);
    ensure(insideRoot(realRoot, target), 'Symbolic link escapes the repository', rel);
    return statSync(target).isFile();
  }
  return stat.isFile();
}

function walkFiles(root, realRoot, dir, found) {
  const full = join(root, dir);
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkFiles(root, realRoot, rel, found);
    else if (entry.isSymbolicLink()) {
      const target = realpathSync(join(root, rel));
      ensure(insideRoot(realRoot, target), 'Symbolic link escapes the repository', rel);
      if (statSync(target).isFile()) found.push(rel);
    } else if (entry.isFile()) found.push(rel);
  }
}

function listDirectory(root, dir) {
  const full = join(root, dir);
  const stat = lstatSync(full, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) return [];
  return readdirSync(full, { withFileTypes: true });
}

function globFiles(root, realRoot, pattern, found) {
  const segments = pattern.split('/');
  function step(dir, index) {
    const segment = segments[index];
    if (segment === '**') {
      if (dir && lstatSync(join(root, dir), { throwIfNoEntry: false })?.isDirectory()) walkFiles(root, realRoot, dir, found);
      return;
    }
    const last = index === segments.length - 1;
    const names = segment.includes('*')
      ? listDirectory(root, dir).map((entry) => entry.name).filter((name) => new RegExp(`^${segmentPattern(segment)}$`).test(name))
      : [segment];
    for (const name of names) {
      const rel = dir ? `${dir}/${name}` : name;
      if (last) {
        if (entryIsFile(root, realRoot, rel)) found.push(rel);
      } else if (lstatSync(join(root, rel), { throwIfNoEntry: false })?.isDirectory()) {
        step(rel, index + 1);
      }
    }
  }
  step('', 0);
}

/**
 * The files of a live tree that any rule could select, walking only below the
 * rules' own directories. Symbolic links to directories are not followed, and
 * a link that resolves outside the root is refused.
 */
export function listCandidates(root, rules) {
  validateRules(rules);
  const realRoot = realpathSync(root);
  const found = [];
  for (const rule of rules) {
    if (rule.kind === 'files') {
      for (const path of rule.paths) if (entryIsFile(root, realRoot, path)) found.push(path);
    } else if (rule.kind === 'glob') {
      globFiles(root, realRoot, rule.pattern, found);
    } else {
      for (const entry of listDirectory(root, rule.dir)) {
        const rel = `${rule.dir}/${entry.name}`;
        if (entryIsFile(root, realRoot, rel)) found.push(rel);
      }
    }
  }
  return [...new Set(found)];
}

/** Read a repository file, refusing any path or link that leaves the root. */
export function readRepositoryFile(root, path) {
  ensure(isSafeRelativePath(path), 'Unsafe inventory path', path);
  const realRoot = realpathSync(root);
  const target = realpathSync(join(root, path));
  ensure(insideRoot(realRoot, target), 'Inventory path resolves outside the repository', path);
  return readFileSync(target);
}

/** One inventory row, in the key order the Python originals wrote. */
export function inventoryRow(path, data) {
  return { path, bytes: data.length, sha256: sha256(data) };
}

/** The digest the snapshot records over its rows. */
export function inventoryDigest(rows) {
  return sha256(canonicalBytes(rows));
}

/** Structural checks that need nothing but the snapshot itself. */
export function verifyStoredSnapshot(snapshot) {
  const rows = snapshot.inventory;
  ensure(Array.isArray(rows) && rows.length > 0, 'Snapshot has no inventory');
  ensure(inventoryDigest(rows) === snapshot.inventorySha256, 'Snapshot inventory digest');
  const paths = rows.map((row) => row.path);
  ensure(new Set(paths).size === paths.length, 'Duplicate inventory path');
  for (const row of rows) {
    ensure(Object.keys(row).join(',') === 'path,bytes,sha256', 'Inventory row shape', row.path);
    ensure(isSafeRelativePath(row.path), 'Unsafe inventory path', row.path);
    ensure(Number.isSafeInteger(row.bytes) && row.bytes >= 0, 'Inventory row size', row.path);
    ensure(SHA256.test(row.sha256), 'Inventory row digest format', row.path);
  }
  ensure(paths.every((path, index) => index === 0 || codePointCompare(paths[index - 1], path) < 0), 'Inventory order');
}

/** A marker a byte source returns for a file whose bytes were never preserved. */
export const LOST = Symbol('lost');

/**
 * Rehash every row through `readFile(path)`, which returns the bytes or `LOST`.
 * A lost file can only be checked against its recorded size and digest, so it
 * is returned rather than silently passed.
 */
export function verifySnapshotBytes(snapshot, readFile) {
  const lost = [];
  let verified = 0;
  for (const row of snapshot.inventory) {
    const data = readFile(row.path);
    if (data === LOST) {
      lost.push({ path: row.path, bytes: row.bytes, sha256: row.sha256 });
      continue;
    }
    ensure(data.length === row.bytes && sha256(data) === row.sha256, 'Changed input', row.path);
    verified++;
  }
  return { verified, lost };
}

/** Membership rebuilt from the rules over `candidates` equals the stored rows. */
export function verifyMembership(snapshot, rules, candidates) {
  const { selected, missingFiles } = selectFromCandidates(rules, candidates);
  ensure(missingFiles.length === 0, 'Selected file missing', missingFiles.slice(0, 5).join(', '));
  const stored = new Set(snapshot.inventory.map((row) => row.path));
  const rebuilt = new Set(selected);
  const extra = selected.filter((path) => !stored.has(path));
  const absent = [...stored].filter((path) => !rebuilt.has(path));
  ensure(
    extra.length === 0 && absent.length === 0,
    'Selected inventory membership changed',
    `not stored: ${JSON.stringify(extra.slice(0, 5))}, not selected: ${JSON.stringify(absent.slice(0, 5))}`
  );
  return { files: selected.length };
}

/** Undo Git's C-style quoting of a path in `git status --short`. */
export function unquoteGitPath(path) {
  if (!path.startsWith('"')) return path;
  const bytes = [];
  const body = path.slice(1, -1);
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (char !== '\\') {
      bytes.push(...Buffer.from(char, 'utf8'));
      continue;
    }
    const next = body[++index];
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(index, index + 3), 8));
      index += 2;
    } else {
      bytes.push({ n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 }[next] ?? next.charCodeAt(0));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * The files Git knew at `gitHead` plus the recorded working tree changes: the
 * candidates an independent membership check can use in replay. Untracked
 * directories are reported, because their contents were never recorded.
 */
export function gitCandidates(trackedPaths, gitStatus) {
  const files = new Set(trackedPaths);
  const untrackedDirectories = [];
  for (const line of gitStatus) {
    const code = line.length > 2 && line[2] === ' ' ? line.slice(0, 2) : line.slice(0, 1).padStart(2, ' ');
    const rest = line.length > 2 && line[2] === ' ' ? line.slice(3) : line.slice(2);
    if (code === '??') {
      const path = unquoteGitPath(rest);
      if (path.endsWith('/')) untrackedDirectories.push(path);
      else files.add(path);
    } else if (code.includes('R') && rest.includes(' -> ')) {
      const [from, to] = rest.split(' -> ').map(unquoteGitPath);
      files.delete(from);
      files.add(to);
    } else if (code.includes('D')) {
      files.delete(unquoteGitPath(rest));
    } else if (code.includes('A')) {
      files.add(unquoteGitPath(rest));
    }
  }
  return { files: [...files], untrackedDirectories };
}

/**
 * Membership checked against Git: every rule except build output is rebuilt
 * from `candidates`; build output rows are taken as stored and reported.
 */
export function verifyMembershipAgainstGit(snapshot, rules, { files, untrackedDirectories }) {
  const buildOutput = rules.filter((rule) => rule.buildOutput).map(matcherFor);
  const isBuildOutput = (path) => buildOutput.some((matches) => matches(path));
  const underUntracked = (path) => untrackedDirectories.some((dir) => path.startsWith(dir));
  const stored = snapshot.inventory.map((row) => row.path);
  const trusted = stored.filter((path) => isBuildOutput(path) || underUntracked(path));
  verifyMembership(snapshot, rules, [...files.filter((path) => !isBuildOutput(path)), ...trusted]);
  return {
    rebuiltFromGit: stored.length - trusted.length,
    takenFromStoredList: trusted.length,
    buildOutputRows: stored.filter(isBuildOutput).length,
    untrackedDirectories,
  };
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
}

/** The tracked files at a commit, from Git objects (needs the commit locally). */
export function gitTrackedPaths(repository, revision) {
  return execFileSync('git', ['ls-tree', '-r', '-z', '--name-only', revision], { cwd: repository, maxBuffer: 1 << 28 })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

/**
 * Capture a snapshot of the live tree and write it once. The file is opened
 * with `wx`, so an existing snapshot is never replaced: the pre-run snapshot is
 * the evidence, and a second capture would destroy it.
 */
export function freezeSnapshot({ root, unit, out, now = new Date(), runGit = git }) {
  ensure(!existsSync(out), 'Refusing to replace an existing snapshot', out);
  const rules = unit.selectionRules;
  const { selected, missingFiles } = selectFromCandidates(rules, listCandidates(root, rules));
  ensure(missingFiles.length === 0, 'Selected file missing', missingFiles.join(', '));
  const rows = selected.map((path) => inventoryRow(path, readRepositoryFile(root, path)));
  const status = runGit(root, ['status', '--short']).trim();
  const snapshot = {
    kind: unit.snapshotKind,
    version: 1,
    createdAt: pythonUtcIsoformat(now),
    gitHead: runGit(root, ['rev-parse', 'HEAD']).trim(),
    gitBranch: runGit(root, ['branch', '--show-current']).trim(),
    gitStatus: status === '' ? [] : status.split('\n'),
    selection: unit.selectionText,
    inventory: rows,
    inventorySha256: inventoryDigest(rows),
  };
  const bytes = indentedBytes(snapshot);
  const handle = openSync(out, 'wx');
  try {
    writeSync(handle, bytes);
  } finally {
    closeSync(handle);
  }
  return {
    snapshot: out,
    files: rows.length,
    bytes: rows.reduce((total, row) => total + row.bytes, 0),
    inventorySha256: snapshot.inventorySha256,
    snapshotSha256: sha256(bytes),
  };
}

/** Check a snapshot against the live tree: bytes and rebuilt membership. */
export function verifyLiveSnapshot(snapshot, root, rules) {
  verifyStoredSnapshot(snapshot);
  const { lost } = verifySnapshotBytes(snapshot, (path) => {
    if (!existsSync(join(root, path))) throw new EvidenceCheckError('Captured input missing', path);
    return readRepositoryFile(root, path);
  });
  ensure(lost.length === 0, 'Captured input missing');
  return verifyMembership(snapshot, rules, listCandidates(root, rules));
}

