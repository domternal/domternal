#!/usr/bin/env node
// Read translation expressions without executing them or importing editor code.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const GENERATED_HEADER = '// Generated from locales/de.ts. Run pnpm locales:generate; do not edit.';
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
export function createLocalePlan(sourceText, { namespaces, inventory, root = repoRoot }) {
  const sourcePath = join(root, 'locales/de.ts');
  const source = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const errors = source.parseDiagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  const inspectRuntimeImports = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (callee.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(callee) && callee.text === 'require')
        || (ts.isPropertyAccessExpression(callee) && (callee.name.text === 'require'
          || (ts.isIdentifier(callee.expression) && callee.expression.text === 'require')))) {
        errors.push('locales/de.ts: runtime import and require calls are not allowed, including inside helpers or callbacks');
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
        errors.push('locales/de.ts: only type-only imports are allowed');
      } else imports.push(statement);
      continue;
    }
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body
      || statement.parameters.length > 0 || statement.typeParameters?.length || statement.asteriskToken
      || statement.modifiers?.length !== 1 || statement.modifiers[0].kind !== ts.SyntaxKind.ExportKeyword) {
      errors.push('locales/de.ts: only type imports and exported, synchronous zero-argument owner functions are allowed');
      continue;
    }
    const name = statement.name.text;
    if (functions.has(name)) errors.push(`locales/de.ts: duplicate owner function ${name}`);
    functions.set(name, statement);
  }
  const expectedFunctions = new Set();
  for (const owner of Object.keys(namespaces).sort()) {
    const parts = owner.split('/');
    if (parts.length !== 2 || !parts[0].startsWith('@') || !/^[a-z][a-z0-9-]*$/.test(parts[1])) {
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
    if (JSON.stringify(returnKeys) !== JSON.stringify(['deMessages', 'deSearchAliases'])) {
      errors.push(`${owner}: finish with return { deMessages, deSearchAliases }`);
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
    const messages = frozenLiteral(constants.get('deMessages')?.initializer, ts.isObjectLiteralExpression);
    const aliases = frozenLiteral(constants.get('deSearchAliases')?.initializer, ts.isObjectLiteralExpression);
    if (!messages) errors.push(`${owner}: deMessages must freeze an explicit object literal`);
    if (!aliases) errors.push(`${owner}: deSearchAliases must freeze an explicit object literal`);
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
    const path = `packages/${packageName}/src/locales/de.ts`;
    const destination = join(root, path);
    const names = usedTypeNames(validStatements);
    const selectedImports = imports.map((statement) => selectImport(statement, names, sourcePath, destination)).filter(Boolean);
    const generatedStatements = validStatements.map((statement) => {
      const name = statement.declarationList.declarations[0].name.text;
      return ['deMessages', 'deSearchAliases'].includes(name)
        ? ts.factory.updateVariableStatement(statement, [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)], statement.declarationList)
        : statement;
    });
    const print = (statement) => printer.printNode(ts.EmitHint.Unspecified, statement, source);
    outputs.set(path, `${GENERATED_HEADER}\n${selectedImports.map(print).join('\n')}\n\n${generatedStatements.map(print).join('\n\n')}\n`);
  }
  for (const name of functions.keys()) if (!expectedFunctions.has(name)) errors.push(`Unknown owner function: ${name}`);
  return { outputs, errors };
}

/** Missing, stale or unexpected generated files are errors, never silent skips. */
export function localeFileProblems(root, outputs) {
  const problems = [];
  for (const [path, expected] of outputs) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) problems.push(`Missing generated locale: ${path}`);
    else if (readFileSync(absolute, 'utf8') !== expected) problems.push(`Stale generated locale: ${path}`);
  }
  const packages = join(root, 'packages');
  if (existsSync(packages)) for (const entry of readdirSync(packages, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(packages, entry.name, 'src/locales');
    if (!existsSync(directory)) continue;
    const visit = (folder) => {
      for (const file of readdirSync(folder, { withFileTypes: true })) {
        const absolute = join(folder, file.name);
        if (file.isDirectory()) { visit(absolute); continue; }
        if (!file.isFile() || !file.name.endsWith('.ts')) continue;
        const path = relative(root, absolute).replaceAll('\\', '/');
        if (outputs.has(path)) continue;
        if (file.name === 'de.ts' || readFileSync(absolute, 'utf8').startsWith(GENERATED_HEADER)) {
          problems.push(`Unexpected generated locale: ${path}`);
        }
      }
    };
    visit(directory);
  }
  return problems;
}

/** Another language needs an explicitly reviewed subpath and catalog contract. */
export function centralLocaleProblems(root) {
  const directory = join(root, 'locales');
  if (!existsSync(directory)) return ['Missing central locale source: locales/de.ts'];
  return readdirSync(directory).filter((name) => name.endsWith('.ts') && name !== 'de.ts')
    .map((name) => `Unsupported central locale source: locales/${name}; review its export and generator contract first`);
}

function main() {
  const unknown = process.argv.slice(2).filter((argument) => argument !== '--check');
  if (unknown.length > 0) throw new Error(`Unknown arguments: ${unknown.join(', ')}`);
  const source = readFileSync(join(repoRoot, 'locales/de.ts'), 'utf8');
  const namespaces = JSON.parse(readFileSync(join(repoRoot, 'tests/i18n/namespaces.json'), 'utf8'));
  const inventory = JSON.parse(readFileSync(join(repoRoot, 'tests/i18n/inventory.json'), 'utf8'));
  const { outputs, errors } = createLocalePlan(source, { namespaces, inventory });
  errors.push(...centralLocaleProblems(repoRoot));
  const fileProblems = localeFileProblems(repoRoot, outputs);
  errors.push(...(process.argv.includes('--check') ? fileProblems : fileProblems.filter((problem) => problem.startsWith('Unexpected'))));
  if (errors.length > 0) {
    console.error(`[locales] FAILED:\n${errors.map((error) => `  ${error}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }
  if (!process.argv.includes('--check')) for (const [path, content] of outputs) {
    mkdirSync(dirname(join(repoRoot, path)), { recursive: true });
    writeFileSync(join(repoRoot, path), content);
  }
  console.log(`[locales] ${process.argv.includes('--check') ? 'Checked' : 'Generated'} German entries from locales/de.ts for ${outputs.size} packages`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
