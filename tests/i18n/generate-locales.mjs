// Read translation expressions without executing them or importing editor code.
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const generatedHeader = (locale) => `// Generated from locales/${locale}.ts. Run pnpm locales:generate; do not edit.`;
// Retained for consumers checking the original German output.
export const GENERATED_HEADER = generatedHeader('de');
const generatedHeaderPattern = /^\/\/ Generated from locales\/([A-Za-z0-9-]+)\.ts\. Run pnpm locales:generate; do not edit\.(?:\r?\n|$)/;

/** Locale paths use canonical BCP 47 tags without extensions or private subtags. */
export function localeSymbols(locale) {
  if (typeof locale !== 'string' || !/^[a-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)) {
    throw new Error(`Invalid locale tag: ${String(locale)}`);
  }
  let canonical;
  try { [canonical] = Intl.getCanonicalLocales(locale); } catch { /* Report the same actionable error below. */ }
  if (canonical !== locale) throw new Error(`Invalid or non-canonical locale tag: ${locale}${canonical ? `; use ${canonical}` : ''}`);
  const prefix = locale.split('-').map((part, index) => index === 0 ? part : part[0].toUpperCase() + part.slice(1)).join('');
  return { messages: `${prefix}Messages`, searchAliases: `${prefix}SearchAliases` };
}

/** Discover sources without evaluating their contents. Invalid entries fail closed. */
export function discoverLocales(root = repoRoot) {
  const directory = join(root, 'locales');
  if (!existsSync(directory)) throw new Error('Missing central locale source: expected locales/*.ts');
  if (lstatSync(directory).isSymbolicLink()) throw new Error('Central locale directory cannot be a symbolic link');
  const locales = [];
  const symbols = new Set();
  const paths = new Set();
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    if (!entry.name.endsWith('.ts')) continue;
    if (!entry.isFile()) throw new Error(`Central locale source must be a regular file: locales/${entry.name}`);
    const locale = entry.name.slice(0, -3);
    const names = localeSymbols(locale);
    if (paths.has(locale.toLowerCase()) || symbols.has(names.messages)) throw new Error(`Colliding central locale source: locales/${entry.name}`);
    paths.add(locale.toLowerCase());
    symbols.add(names.messages);
    locales.push(locale);
  }
  if (locales.length === 0) throw new Error('Missing central locale source: expected locales/*.ts');
  return locales;
}

/** Public subpath contract shared by package wiring and its validation. */
export function localeExport(locale, sourceCondition) {
  localeSymbols(locale);
  return {
    ...(sourceCondition ? { [sourceCondition]: `./src/locales/${locale}.ts` } : {}),
    import: { types: `./dist/locales/${locale}.d.ts`, default: `./dist/locales/${locale}.js` },
    require: { types: `./dist/locales/${locale}.d.cts`, default: `./dist/locales/${locale}.cjs` },
  };
}
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const packageFunction = (name) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

function unwrap(expression) {
  while (expression && (ts.isParenthesizedExpression(expression) || ts.isSatisfiesExpression(expression)
    || ts.isAsExpression(expression))) expression = expression.expression;
  return expression;
}

function frozenLiteral(expression, isLiteral) {
  const call = unwrap(expression);
  if (!call || !ts.isCallExpression(call) || call.arguments.length !== 1
    || !ts.isPropertyAccessExpression(call.expression)
    || !ts.isIdentifier(call.expression.expression) || call.expression.expression.text !== 'Object'
    || call.expression.name.text !== 'freeze') return undefined;
  const literal = unwrap(call.arguments[0]);
  return literal && isLiteral(literal) ? literal : undefined;
}

function literalProperties(object, description, errors) {
  const entries = new Map();
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.name)) {
      errors.push(`${description}: use explicit quoted keys, without spreads or computed properties`);
      continue;
    }
    const key = property.name.text;
    if (entries.has(key)) errors.push(`${description}: duplicate key ${key}`);
    entries.set(key, property.initializer);
  }
  return entries;
}

function usedTypeNames(statements) {
  const names = new Set();
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isPropertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node)
        || ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)
          || ts.isMethodDeclaration(parent)) && parent.name === node);
      const isBinding = (ts.isVariableDeclaration(parent) || ts.isParameter(parent)) && parent.name === node;
      if (!isPropertyName && !isBinding) names.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  statements.forEach(visit);
  return names;
}

function selectImport(statement, names, sourcePath, destination) {
  const clause = statement.importClause;
  const defaultName = clause.name && names.has(clause.name.text) ? clause.name : undefined;
  let bindings;
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    if (names.has(clause.namedBindings.name.text)) bindings = clause.namedBindings;
  } else if (clause.namedBindings) {
    const selected = clause.namedBindings.elements.filter((element) => names.has(element.name.text))
      .map((element) => ts.factory.updateImportSpecifier(element, false, element.propertyName, element.name));
    if (selected.length > 0) bindings = ts.factory.updateNamedImports(clause.namedBindings, selected);
  }
  if (!defaultName && !bindings) return undefined;
  let specifier = statement.moduleSpecifier.text;
  if (specifier.startsWith('.')) {
    specifier = relative(dirname(destination), resolve(dirname(sourcePath), specifier)).replaceAll('\\', '/');
    if (!specifier.startsWith('.')) specifier = `./${specifier}`;
  }
  const selected = ts.factory.updateImportDeclaration(statement, statement.modifiers,
    ts.factory.updateImportClause(clause, true, defaultName, bindings),
    ts.factory.createStringLiteral(specifier), statement.attributes);
  return ts.setEmitFlags(selected, ts.EmitFlags.NoLeadingComments | ts.EmitFlags.NoTrailingComments);
}

/** Pure AST transformation. No callback, function or source import is evaluated. */
export function createLocalePlan(sourceText, { namespaces, inventory, root = repoRoot, locale = 'de' }) {
  let symbols;
  try { symbols = localeSymbols(locale); } catch (error) { return { outputs: new Map(), errors: [error.message] }; }
  if (!namespaces || typeof namespaces !== 'object' || Array.isArray(namespaces) || Object.keys(namespaces).length === 0) {
    return { outputs: new Map(), errors: ['namespaces.json must contain at least one message owner'] };
  }
  if (!Array.isArray(inventory?.messages)) return { outputs: new Map(), errors: ['inventory.json must contain a messages array'] };
  const sourceName = `locales/${locale}.ts`;
  const sourcePath = join(root, sourceName);
  const source = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const errors = source.parseDiagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  const inspectRuntimeImports = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (callee.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(callee) && callee.text === 'require')
        || (ts.isPropertyAccessExpression(callee) && (callee.name.text === 'require'
          || (ts.isIdentifier(callee.expression) && callee.expression.text === 'require')))) {
        errors.push(`${sourceName}: runtime import and require calls are not allowed, including inside helpers or callbacks`);
      }
    }
    ts.forEachChild(node, inspectRuntimeImports);
  };
  inspectRuntimeImports(source);
  const imports = [];
  const functions = new Map();
  const outputs = new Map();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const namedTypeImports = clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
        && !clause.name && clause.namedBindings.elements.length > 0
        && clause.namedBindings.elements.every((element) => element.isTypeOnly);
      if (!clause || (!clause.isTypeOnly && !namedTypeImports)
        || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
        errors.push(`${sourceName}: only type-only imports are allowed`);
      } else imports.push(statement);
      continue;
    }
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body
      || statement.parameters.length > 0 || statement.typeParameters?.length || statement.asteriskToken
      || statement.modifiers?.length !== 1 || statement.modifiers[0].kind !== ts.SyntaxKind.ExportKeyword) {
      errors.push(`${sourceName}: only type imports and exported, synchronous zero-argument owner functions are allowed`);
      continue;
    }
    const name = statement.name.text;
    if (functions.has(name)) errors.push(`${sourceName}: duplicate owner function ${name}`);
    functions.set(name, statement);
  }
  const expectedFunctions = new Set();
  for (const owner of Object.keys(namespaces).sort()) {
    const parts = owner.split('/');
    if (parts.length !== 2 || !/^@[a-z0-9][a-z0-9-]*$/.test(parts[0]) || !/^[a-z][a-z0-9-]*$/.test(parts[1])) {
      errors.push(`Invalid package owner: ${owner}`);
      continue;
    }
    const packageName = parts[1];
    const functionName = packageFunction(packageName);
    if (expectedFunctions.has(functionName)) errors.push(`Owner function collision: ${functionName}`);
    expectedFunctions.add(functionName);
    const declaration = functions.get(functionName);
    if (!declaration) {
      errors.push(`${owner}: missing owner function ${functionName}`);
      continue;
    }
    const statements = [...declaration.body.statements];
    const returned = statements.pop();
    const returnKeys = returned && ts.isReturnStatement(returned) && returned.expression
      && ts.isObjectLiteralExpression(returned.expression)
      && returned.expression.properties.every((property) => ts.isShorthandPropertyAssignment(property)
        && !property.objectAssignmentInitializer)
      ? returned.expression.properties.map((property) => property.name.text).sort() : [];
    if (JSON.stringify(returnKeys) !== JSON.stringify([symbols.messages, symbols.searchAliases].sort())) {
      errors.push(`${owner}: finish with return { ${symbols.messages}, ${symbols.searchAliases} }`);
    }
    const constants = new Map();
    const validStatements = [];
    for (const statement of statements) {
      if (!ts.isVariableStatement(statement) || statement.modifiers?.length
        || !(statement.declarationList.flags & ts.NodeFlags.Const)
        || statement.declarationList.declarations.length !== 1) {
        errors.push(`${owner}: owner bodies may contain only individual const declarations before the return`);
        continue;
      }
      const variable = statement.declarationList.declarations[0];
      if (!ts.isIdentifier(variable.name) || !variable.initializer || variable.name.text === 'Object') {
        errors.push(`${owner}: constants need an identifier and initializer; Object cannot be shadowed`);
        continue;
      }
      const name = variable.name.text;
      if (constants.has(name)) errors.push(`${owner}: duplicate constant ${name}`);
      constants.set(name, variable);
      validStatements.push(statement);
    }
    const messages = frozenLiteral(constants.get(symbols.messages)?.initializer, ts.isObjectLiteralExpression);
    const aliases = frozenLiteral(constants.get(symbols.searchAliases)?.initializer, ts.isObjectLiteralExpression);
    if (!messages) errors.push(`${owner}: ${symbols.messages} must freeze an explicit object literal`);
    if (!aliases) errors.push(`${owner}: ${symbols.searchAliases} must freeze an explicit object literal`);
    const definitions = inventory.messages.filter((message) => message.owner === owner);
    if (definitions.length === 0) errors.push(`${owner}: no reviewed English messages in inventory.json`);
    const expectedKeys = new Set(definitions.map((message) => message.id));
    const actualMessages = messages ? literalProperties(messages, `${owner} messages`, errors) : new Map();
    for (const key of expectedKeys) if (!actualMessages.has(key)) errors.push(`${owner}: missing message ${key}`);
    for (const [key, value] of actualMessages) {
      if (!expectedKeys.has(key)) errors.push(`${owner}: unknown or cross-owner message ${key}`);
      const definition = definitions.find((message) => message.id === key);
      const unwrapped = unwrap(value);
      if (ts.isNumericLiteral(unwrapped) || ts.isBigIntLiteral(unwrapped)
        || ts.isObjectLiteralExpression(unwrapped) || ts.isArrayLiteralExpression(unwrapped)
        || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(unwrapped.kind)) {
        errors.push(`${owner}: message ${key} must be text or a typed translation function`);
      }
      if (definition && ts.isStringLiteralLike(unwrapped) && !definition.allowEmpty && unwrapped.text.trim() === '') {
        errors.push(`${owner}: required message ${key} cannot be empty`);
      }
    }
    const aliasEntries = aliases ? literalProperties(aliases, `${owner} search aliases`, errors) : new Map();
    for (const [key, value] of aliasEntries) {
      const definition = definitions.find((message) => message.id === key);
      if (!definition?.searchable) errors.push(`${owner}: alias ${key} must be an owned searchable message`);
      const array = frozenLiteral(value, ts.isArrayLiteralExpression);
      if (!array || array.elements.some((element) => !ts.isStringLiteralLike(element) || element.text.trim() === '')) {
        errors.push(`${owner}: alias ${key} must freeze an array of non-empty string literals`);
      } else if (new Set(array.elements.map((element) => element.text)).size !== array.elements.length) {
        errors.push(`${owner}: duplicate aliases for ${key}`);
      }
    }
    const path = `packages/${packageName}/src/locales/${locale}.ts`;
    const destination = join(root, path);
    const names = usedTypeNames(validStatements);
    const selectedImports = imports.map((statement) => selectImport(statement, names, sourcePath, destination)).filter(Boolean);
    const generatedStatements = validStatements.map((statement) => {
      const name = statement.declarationList.declarations[0].name.text;
      return [symbols.messages, symbols.searchAliases].includes(name)
        ? ts.factory.updateVariableStatement(statement, [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)], statement.declarationList)
        : statement;
    });
    const print = (statement) => printer.printNode(ts.EmitHint.Unspecified, statement, source);
    outputs.set(path, `${generatedHeader(locale)}\n${selectedImports.map(print).join('\n')}\n\n${generatedStatements.map(print).join('\n\n')}\n`);
  }
  for (const name of functions.keys()) if (!expectedFunctions.has(name)) errors.push(`Unknown owner function: ${name}`);
  return { outputs, errors };
}

/** Collect every output once so all sources are validated before any file changes. */
export function createRepositoryLocalePlan(root = repoRoot) {
  const errors = [];
  const outputs = new Map();
  let locales = [];
  try { locales = discoverLocales(root); } catch (error) { errors.push(error.message); }
  const namespaces = JSON.parse(readFileSync(join(root, 'tests/i18n/namespaces.json'), 'utf8'));
  const inventory = JSON.parse(readFileSync(join(root, 'tests/i18n/inventory.json'), 'utf8'));
  if (!namespaces || typeof namespaces !== 'object' || Array.isArray(namespaces) || Object.keys(namespaces).length === 0) {
    errors.push('namespaces.json must contain at least one message owner');
  }
  for (const locale of locales) {
    const source = readFileSync(join(root, 'locales', `${locale}.ts`), 'utf8');
    const result = createLocalePlan(source, { namespaces, inventory, root, locale });
    errors.push(...result.errors.map((error) => `${locale}: ${error}`));
    for (const [path, content] of result.outputs) outputs.set(path, content);
  }
  for (const owner of Object.keys(namespaces ?? {})) {
    if (!/^@[a-z0-9][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(owner)) continue;
    const packageName = owner.split('/')[1];
    const path = `packages/${packageName}/package.json`;
    const absolute = join(root, path);
    if (!existsSync(absolute)) { errors.push(`Missing locale owner manifest: ${path}`); continue; }
    if (!lstatSync(absolute).isFile()) { errors.push(`Locale owner manifest must be a regular file: ${path}`); continue; }
    let manifest;
    try { manifest = JSON.parse(readFileSync(absolute, 'utf8')); } catch { errors.push(`Invalid locale owner manifest: ${path}`); continue; }
    if (manifest.name !== owner) { errors.push(`Locale owner manifest name mismatch: ${path}`); continue; }
    const update = (exports, sourceCondition) => {
      if (!exports || typeof exports !== 'object' || Array.isArray(exports) || !Object.hasOwn(exports, '.')) {
        errors.push(`Locale owner manifest needs explicit package exports: ${path}`);
        return exports;
      }
      const result = Object.fromEntries(Object.entries(exports).filter(([key]) => !key.startsWith('./locales/')));
      for (const locale of locales) result[`./locales/${locale}`] = localeExport(locale, sourceCondition);
      return result;
    };
    manifest.exports = update(manifest.exports, `${owner.split('/')[0]}/source`);
    if (manifest.publishConfig?.exports) manifest.publishConfig.exports = update(manifest.publishConfig.exports);
    outputs.set(path, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return { locales, outputs, errors };
}

function outputPathProblems(root, outputs) {
  const problems = [];
  for (const path of outputs.keys()) {
    let current = root;
    const parts = path.split('/');
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      const status = lstatSync(current, { throwIfNoEntry: false });
      if (!status) break;
      if (status.isSymbolicLink()) { problems.push(`Locale output path cannot contain a symbolic link: ${relative(root, current)}`); break; }
      if (index < parts.length - 1 && !status.isDirectory()) { problems.push(`Locale output parent must be a directory: ${relative(root, current)}`); break; }
    }
  }
  return problems;
}

function localeFiles(root) {
  const files = [];
  const problems = [];
  const packages = join(root, 'packages');
  if (!existsSync(packages)) return { files, problems };
  if (lstatSync(packages).isSymbolicLink()) return { files, problems: ['Locale packages directory cannot be a symbolic link'] };
  const visit = (folder) => {
    for (const file of readdirSync(folder, { withFileTypes: true })) {
      const absolute = join(folder, file.name);
      const path = relative(root, absolute).replaceAll('\\', '/');
      if (file.isSymbolicLink()) {
        problems.push(`Locale output cannot be a symbolic link: ${path}`);
        continue;
      }
      if (file.isDirectory()) { visit(absolute); continue; }
      if (!file.isFile() || !file.name.endsWith('.ts') || file.name.endsWith('.test.ts') || file.name.endsWith('.d.ts')) continue;
      const content = readFileSync(absolute, 'utf8');
      files.push({ path, content, generated: generatedHeaderPattern.test(content) });
    }
  };
  for (const entry of readdirSync(packages, { withFileTypes: true })) {
    const directory = join(packages, entry.name, 'src/locales');
    if (entry.isSymbolicLink()) {
      if (existsSync(directory)) problems.push(`Locale package cannot be a symbolic link: packages/${entry.name}`);
      continue;
    }
    if (!entry.isDirectory() || !existsSync(directory)) continue;
    if (lstatSync(directory).isSymbolicLink() || lstatSync(join(packages, entry.name, 'src')).isSymbolicLink()) {
      problems.push(`Locale output directory cannot be a symbolic link: packages/${entry.name}/src/locales`);
      continue;
    }
    visit(directory);
  }
  return { files, problems };
}

/** Missing, stale or unexpected generated files are errors, never silent skips. */
export function localeFileProblems(root, outputs) {
  const { files, problems } = localeFiles(root);
  const actual = new Map(files.map((file) => [file.path, file]));
  for (const [path, expected] of outputs) {
    if (path.endsWith('/package.json')) {
      const absolute = join(root, path);
      if (!existsSync(absolute)) problems.push(`Missing locale owner manifest: ${path}`);
      else if (readFileSync(absolute, 'utf8') !== expected) problems.push(`Stale locale owner manifest: ${path}`);
      continue;
    }
    const file = actual.get(path);
    if (!file) problems.push(`Missing generated locale: ${path}`);
    else if (file.content !== expected) problems.push(`Stale generated locale: ${path}`);
  }
  for (const file of files) if (!outputs.has(file.path)) problems.push(`Unexpected generated locale: ${file.path}`);
  return problems;
}

export function centralLocaleProblems(root) {
  try { discoverLocales(root); return []; } catch (error) { return [error.message]; }
}

function writeAtomically(path, content) {
  // Parallel owner builds can read other packages while their outputs are refreshed.
  const temporary = `${path}.locale-${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/** Generate source modules and export maps from the same discovered tags. */
export function generateLocales({ root = repoRoot, check = false, owner } = {}) {
  const { locales, outputs, errors } = createRepositoryLocalePlan(root);
  if (owner && !Object.keys(JSON.parse(readFileSync(join(root, 'tests/i18n/namespaces.json'), 'utf8'))).includes(owner)) {
    errors.push(`Unknown locale owner: ${owner}`);
  }
  const selected = new Map([...outputs].filter(([path]) => !owner || path.startsWith(`packages/${owner.split('/')[1]}/`)));
  const scanned = localeFiles(root);
  errors.push(...scanned.problems, ...outputPathProblems(root, outputs));
  // A handwritten file is never overwritten or removed by generation.
  for (const file of scanned.files) if (!file.generated) errors.push(`Unmanaged locale output: ${file.path}; move it outside src/locales before generating`);
  if (check) errors.push(...localeFileProblems(root, outputs));
  if (errors.length > 0) throw new Error(`[locales] FAILED:\n${[...new Set(errors)].map((error) => `  ${error}`).join('\n')}`);
  if (!check) {
    for (const file of scanned.files) if (!outputs.has(file.path) && (!owner || file.path.startsWith(`packages/${owner.split('/')[1]}/`))) {
      unlinkSync(join(root, file.path));
    }
    for (const [path, content] of selected) {
      const absolute = join(root, path);
      if (existsSync(absolute) && readFileSync(absolute, 'utf8') === content) continue;
      mkdirSync(dirname(absolute), { recursive: true });
      writeAtomically(absolute, content);
    }
  }
  return { locales, outputs: selected };
}

function main() {
  const unknown = process.argv.slice(2).filter((argument) => argument !== '--check');
  if (unknown.length > 0) throw new Error(`Unknown arguments: ${unknown.join(', ')}`);
  const check = process.argv.includes('--check');
  try {
    const { locales, outputs } = generateLocales({ check });
    console.log(`[locales] ${check ? 'Checked' : 'Generated'} ${[...outputs.keys()].filter((path) => path.endsWith('.ts')).length} package locale entries from ${locales.map((locale) => `locales/${locale}.ts`).join(', ')}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
