#!/usr/bin/env node
// Published packages must share ProseMirror through @domternal/pm, and module
// augmentations must name a package. Parsing the source instead of grepping it
// makes the policy independent of quote style and covers import/export/require
// forms without matching comments or ordinary strings.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packagesRoot = join(repoRoot, 'packages');
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const directProseMirror = /^prosemirror-[a-z0-9-]+(?:\/|$)/;

// One negative-control test deliberately resolves the upstream package to
// create a real duplicate module instance. Exact, test-pinned exemptions keep
// that proof possible without weakening the policy for any other source file.
export const REPOSITORY_EXEMPTIONS = new Set([
  'core/src/utils/prosemirrorDuplicateCopy.test.ts\0direct-prosemirror-import\0prosemirror-model',
]);

function scriptKind(file) {
  switch (extname(file)) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function stringValue(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function importTypeSpecifier(node) {
  if (!ts.isImportTypeNode(node) || !ts.isLiteralTypeNode(node.argument)) return null;
  return stringValue(node.argument.literal);
}

function callSpecifier(node) {
  if (!ts.isCallExpression(node) || node.arguments.length === 0) return null;
  const first = stringValue(node.arguments[0]);
  if (first === null) return null;

  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return first;
  if (ts.isIdentifier(node.expression) && node.expression.text === 'require') return first;
  if (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'module' &&
    node.expression.name.text === 'require'
  ) {
    return first;
  }
  if (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'require' &&
    node.expression.name.text === 'resolve'
  ) {
    return first;
  }
  return null;
}

function externalSpecifier(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return stringValue(node.moduleSpecifier);
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return stringValue(node.moduleReference.expression);
  }
  return importTypeSpecifier(node) ?? callSpecifier(node);
}

function location(sourceFile, node) {
  const start = node.getStart(sourceFile);
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
  return { line: line + 1, column: character + 1 };
}

/** Return every source-boundary violation in one JS/TS source file. */
export function sourceBoundaryViolations(source, file = 'fixture.ts', options = {}) {
  const allowDirectProseMirror = options.allowDirectProseMirror === true;
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file)
  );
  const violations = [];

  function visit(node) {
    if (ts.isModuleDeclaration(node)) {
      const name = stringValue(node.name);
      if (name?.startsWith('.')) {
        violations.push({
          ...location(sourceFile, node.name),
          kind: 'relative-module-augmentation',
          specifier: name,
          message: `augment a package name instead of the relative module "${name}"`,
        });
      }
    }

    const specifier = externalSpecifier(node);
    if (!allowDirectProseMirror && specifier !== null && directProseMirror.test(specifier)) {
      const locationNode =
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
          ? node.moduleSpecifier
          : node;
      violations.push({
        ...location(sourceFile, locationNode),
        kind: 'direct-prosemirror-import',
        specifier,
        message: `import "${specifier}" through @domternal/pm`,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

export function checkRepository(root = packagesRoot) {
  const violations = [];
  const usedExemptions = new Set();
  for (const packageEntry of readdirSync(root, { withFileTypes: true })) {
    if (!packageEntry.isDirectory()) continue;
    const sourceRoot = join(root, packageEntry.name, 'src');
    let files;
    try {
      files = sourceFiles(sourceRoot);
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') continue;
      throw error;
    }

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const violation of sourceBoundaryViolations(source, file, {
        allowDirectProseMirror: packageEntry.name === 'pm',
      })) {
        const path = relative(root, file).split(sep).join('/');
        const exemption = `${path}\0${violation.kind}\0${violation.specifier}`;
        if (REPOSITORY_EXEMPTIONS.has(exemption) && !usedExemptions.has(exemption)) {
          usedExemptions.add(exemption);
          continue;
        }
        violations.push({ ...violation, file });
      }
    }
  }
  if (resolve(root) === resolve(packagesRoot)) {
    for (const exemption of REPOSITORY_EXEMPTIONS) {
      if (usedExemptions.has(exemption)) continue;
      const [path, kind, specifier] = exemption.split('\0');
      violations.push({
        file: join(root, path),
        line: 1,
        column: 1,
        kind,
        specifier,
        message: `remove stale source-boundary exemption for "${specifier}"`,
      });
    }
  }
  return violations;
}

function displayPath(path) {
  return relative(repoRoot, path).split(sep).join('/');
}

function main() {
  const violations = checkRepository();
  if (violations.length > 0) {
    console.error('[source-boundaries] FAILED:');
    for (const violation of violations) {
      console.error(
        `  - ${displayPath(violation.file)}:${String(violation.line)}:${String(violation.column)} ` +
          violation.message
      );
    }
    process.exit(1);
  }

  console.log('[source-boundaries] OK - package augmentations and ProseMirror imports are safe');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
