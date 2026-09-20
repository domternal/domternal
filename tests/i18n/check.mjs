import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const normalize = (value) => value.replace(/\s+/g, ' ').trim();
const uiProperties = new Set([
  'label',
  'title',
  'description',
  'placeholder',
  'ariaLabel',
  'aria-label',
  'aria-description',
  'aria-valuetext',
  'disabledReason',
  'groupLabel',
  'emptyText',
  'emptyMessage',
  'submitLabel',
  'cancelLabel',
]);
const domProperties = new Set([
  'textContent',
  'innerText',
  'title',
  'placeholder',
  'ariaLabel',
  'ariaDescription',
  'ariaValueText',
  'alt',
]);
const uiAttributes = new Set([
  'aria-label',
  'aria-description',
  'aria-valuetext',
  'title',
  'placeholder',
  'alt',
]);
const buttonHelpers = new Set([
  'createButton',
  'makeButton',
  'actionButton',
  'menuButton',
  'createMenuItem',
]);
const printer = ts.createPrinter({ removeComments: true });
const ignoredDirectories = new Set(['node_modules', 'dist', 'coverage', '__tests__', '__mocks__']);
const hasWords = (text) => /\p{L}/u.test(text.trim());
const nameOf = (node) =>
  node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node))
    ? node.text
    : undefined;
const unwrap = (node) => {
  while (
    node &&
    (ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isTypeAssertionExpression(node))
  )
    node = node.expression;
  return node;
};
const expressionSource = (node, source) =>
  printer.printNode(ts.EmitHint.Unspecified, node, source).trim();

function walkFiles(directory, boundary = false) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (
      ignoredDirectories.has(entry.name) &&
      !(boundary && ['__tests__', '__mocks__'].includes(entry.name))
    )
      return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(path, boundary);
    if (
      !boundary &&
      (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name) || /\.d\.[cm]?ts$/.test(entry.name))
    )
      return [];
    return /\.([cm]?[jt]sx?|vue|html|s?css)$/.test(entry.name) ? [path] : [];
  });
}

function scopeOf(node) {
  const scopes = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isVariableDeclaration(parent)
    ) {
      const name = nameOf(parent.name);
      if (name) scopes.unshift(name);
    }
  }
  return scopes.join('.') || '<module>';
}

function literalParts(node, checker, seen = new Set()) {
  node = unwrap(node);
  if (!node) return [];
  if (ts.isIdentifier(node) && checker) {
    const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
    if (
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      ts.isVariableDeclarationList(declaration.parent) &&
      declaration.parent.flags & ts.NodeFlags.Const &&
      !seen.has(declaration)
    ) {
      return literalParts(declaration.initializer, checker, new Set([...seen, declaration])).map(
        (part) => ({ ...part, node })
      );
    }
  }
  if (ts.isArrayLiteralExpression(node))
    return node.elements.flatMap((item) => literalParts(item, checker, seen));
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  )
    return literalParts(node.right, checker, seen);
  if (ts.isStringLiteralLike(node)) return [{ node, text: node.text }];
  if (ts.isTemplateExpression(node)) {
    return [
      {
        node,
        text: [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('${…}'),
      },
    ];
  }
  if (ts.isConditionalExpression(node))
    return [
      ...literalParts(node.whenTrue, checker, seen),
      ...literalParts(node.whenFalse, checker, seen),
    ];
  if (
    ts.isBinaryExpression(node) &&
    [
      ts.SyntaxKind.PlusToken,
      ts.SyntaxKind.QuestionQuestionToken,
      ts.SyntaxKind.BarBarToken,
    ].includes(node.operatorToken.kind)
  ) {
    return [...literalParts(node.left, checker, seen), ...literalParts(node.right, checker, seen)];
  }
  return [];
}

function declarationsIn(source, declarations, searchable, errors, file) {
  const visit = (node) => {
    if (
      ts.isInterfaceDeclaration(node) &&
      ['MessageParameters', 'SearchableMessages'].includes(node.name.text)
    ) {
      let parent = node.parent;
      while (parent && !ts.isModuleDeclaration(parent)) parent = parent.parent;
      if (parent && nameOf(parent.name) === '@domternal/core') {
        for (const member of node.members) {
          const id = nameOf(member.name);
          if (!ts.isPropertySignature(member) || !id || !member.type) {
            errors.push(
              `${file}: ${node.name.text} requires explicit typed message keys; index signatures are forbidden.`
            );
            continue;
          }
          if (node.name.text === 'SearchableMessages') {
            if (member.type.getText(source) !== 'true')
              errors.push(`${file}: searchable marker ${id} must be true.`);
            if (searchable.has(id)) errors.push(`${file}: duplicate searchable declaration ${id}.`);
            searchable.set(id, file);
          } else {
            if (declarations.has(id))
              errors.push(`${file}: duplicate MessageParameters declaration ${id}.`);
            const fields = ts.isTypeLiteralNode(member.type)
              ? member.type.members.map((field) => ({
                  name: nameOf(field.name),
                  type: field.type ? expressionSource(field.type, source) : 'unknown',
                  optional: !!field.questionToken,
                }))
              : [];
            if (fields.some((field) => !field.name || field.type === 'unknown'))
              errors.push(`${file}: invalid parameter shape for ${id}.`);
            declarations.set(id, { type: expressionSource(member.type, source), fields, file });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/** Extract source data without importing packages or executing default callbacks. */
function catalogIn(source, file, packageName, errors) {
  const defineNames = new Set(['defineMessage']);
  const factories = new Map();
  const constants = new Map();
  const entries = [];
  source.i18nDefinitionCalls = new Set();
  const collect = (node) => {
    if (
      ts.isImportSpecifier(node) &&
      (node.propertyName?.text ?? node.name.text) === 'defineMessage'
    )
      defineNames.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
      constants.set(node.name.text, node.initializer);
    ts.forEachChild(node, collect);
  };
  collect(source);
  const findFactory = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const statement = node.body.statements.find((item) => ts.isReturnStatement(item));
      const call = statement?.expression;
      if (call && ts.isCallExpression(call) && defineNames.has(nameOf(call.expression)))
        factories.set(node.name.text, { node, call });
    }
    ts.forEachChild(node, findFactory);
  };
  findFactory(source);
  const evaluate = (node, environment = new Map(), seen = new Set()) => {
    node = unwrap(node);
    if (!node) return undefined;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return { callback: node };
    if (ts.isArrayLiteralExpression(node))
      return node.elements.map((element) => evaluate(element, environment, seen));
    if (ts.isIdentifier(node)) {
      if (environment.has(node.text)) return environment.get(node.text);
      if (!seen.has(node.text) && constants.has(node.text))
        return evaluate(constants.get(node.text), environment, new Set([...seen, node.text]));
    }
    return { unresolved: node.getText(source) };
  };
  const extract = (object, environment, location) => {
    source.i18nDefinitionCalls.add(location);
    object = unwrap(object);
    if (!object || !ts.isObjectLiteralExpression(object)) {
      errors.push(
        `${file}: message definition at line ${source.getLineAndCharacterOfPosition(location.getStart(source)).line + 1} must be a statically readable object.`
      );
      return;
    }
    const values = {};
    for (const property of object.properties) {
      if (ts.isPropertyAssignment(property))
        values[nameOf(property.name)] = evaluate(property.initializer, environment);
      else if (ts.isShorthandPropertyAssignment(property))
        values[property.name.text] = evaluate(property.name, environment);
      else
        errors.push(
          `${file}: message definition spreads or computed properties require an explicit catalog entry.`
        );
    }
    const id = values.id;
    if (typeof id !== 'string' || !/^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/.test(id)) {
      errors.push(
        `${file}: message id must be a static namespaced key, received ${JSON.stringify(id)}.`
      );
      return;
    }
    if (values.owner !== packageName) errors.push(`${file}: ${id} owner must be ${packageName}.`);
    if (typeof values.description !== 'string' || !values.description.trim())
      errors.push(`${file}: ${id} needs a translator description.`);
    if (values.allowEmpty !== undefined && typeof values.allowEmpty !== 'boolean')
      errors.push(`${file}: ${id} allowEmpty must be a boolean.`);
    const allowEmpty = values.allowEmpty === true;
    const defaultValue = values.defaultValue;
    if (!(typeof defaultValue === 'string' || defaultValue?.callback))
      errors.push(`${file}: ${id} default must be English text or a source callback.`);
    if (typeof defaultValue === 'string' && !allowEmpty && !defaultValue.trim())
      errors.push(`${file}: ${id} has an empty required default.`);
    for (const name of ['searchAliases', 'technicalAliases']) {
      const aliases = values[name];
      if (
        aliases !== undefined &&
        (!Array.isArray(aliases) ||
          aliases.some((alias) => typeof alias !== 'string' || !alias.trim()) ||
          new Set(aliases).size !== aliases.length)
      ) {
        errors.push(`${file}: ${id} ${name} must contain unique non-empty strings.`);
      }
    }
    const callback = defaultValue?.callback;
    if (callback) {
      const checkResult = (expression) => {
        const value = unwrap(expression);
        if (value && ts.isConditionalExpression(value)) {
          checkResult(value.whenTrue);
          checkResult(value.whenFalse);
          return;
        }
        if (
          !value ||
          ts.isNumericLiteral(value) ||
          ts.isObjectLiteralExpression(value) ||
          ts.isArrayLiteralExpression(value) ||
          [
            ts.SyntaxKind.TrueKeyword,
            ts.SyntaxKind.FalseKeyword,
            ts.SyntaxKind.NullKeyword,
          ].includes(value.kind)
        ) {
          errors.push(`${file}: ${id} default callback returns a non-string literal.`);
        }
        if (value && ts.isStringLiteralLike(value) && !value.text.trim() && !allowEmpty) {
          errors.push(`${file}: ${id} default callback returns an empty required string.`);
        }
      };
      const checkReturn = (node) => {
        if (ts.isFunctionLike(node)) return;
        if (ts.isReturnStatement(node)) checkResult(node.expression);
        ts.forEachChild(node, checkReturn);
      };
      if (ts.isBlock(callback.body)) checkReturn(callback.body);
      else checkResult(callback.body);
    }

    entries.push({
      id,
      owner: values.owner,
      description: values.description,
      allowEmpty,
      default:
        typeof defaultValue === 'string'
          ? { kind: 'text', value: defaultValue }
          : { kind: 'function', source: callback ? expressionSource(callback, source) : '' },
      searchAliases: values.searchAliases ?? [],
      technicalAliases: values.technicalAliases ?? [],
      source: file,
      callback,
    });
  };
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && factories.has(node.name.text)) return;
    if (ts.isCallExpression(node)) {
      const name = nameOf(node.expression);
      if (defineNames.has(name)) extract(node.arguments[0], new Map(), node);
      else if (factories.has(name)) {
        const factory = factories.get(name);
        const environment = new Map(
          factory.node.parameters.map((parameter, index) => [
            nameOf(parameter.name),
            evaluate(node.arguments[index] ?? parameter.initializer),
          ])
        );
        extract(factory.call.arguments[0], environment, node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return entries;
}

function htmlLiterals(text, emit) {
  // Keep ignored regions as boundaries so their neighbours cannot form new markup delimiters.
  let cleaned = text
    .replace(/\$\{[^}]*\}|\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  // Strip Angular control expressions before treating angle brackets as markup.
  cleaned = cleaned.replace(/@(if|for|switch|case|else if)\s*\((?:[^()]|\([^()]*\))*\)/g, '');
  for (const match of cleaned.matchAll(
    /\b(aria-label|aria-description|aria-valuetext|title|placeholder|alt)\s*=\s*(["'])(.*?)\2/gs
  )) {
    // Angular bindings have a closing bracket before the equals sign and do not match.
    if (hasWords(match[3])) emit(`template:${match[1]}`, normalize(match[3]));
  }
  for (const match of cleaned.matchAll(/>([^<>]+)</g)) {
    const value = normalize(match[1].replace(/[{}]/g, ''));
    if (hasWords(value) && !/^[@{}]/.test(value)) emit('template:text', value);
  }
}

function uiLiteralsIn(source, file, checker) {
  const findings = [];
  const seen = new Set();
  const emit = (node, sink, text) => {
    if (!hasWords(text)) return;
    const position = node.getStart(source);
    const identity = JSON.stringify([position, sink, text]);
    if (seen.has(identity)) return;
    seen.add(identity);
    findings.push({
      file,
      context: scopeOf(node),
      sink,
      text,
      line: source.getLineAndCharacterOfPosition(position).line + 1,
    });
  };
  const inspect = (node, sink) => {
    for (const part of literalParts(node, checker)) emit(part.node, sink, part.text);
  };
  const html = (node) => {
    for (const part of literalParts(node, checker))
      htmlLiterals(part.text, (sink, text) => emit(part.node, sink, text));
  };
  const visit = (node) => {
    if (source.i18nDefinitionCalls?.has(node)) return;
    if (ts.isPropertyAssignment(node)) {
      const name = nameOf(node.name);
      if (uiProperties.has(name)) inspect(node.initializer, `property:${name}`);
      if (name === 'template') html(node.initializer);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left)
    ) {
      const name = node.left.name.text;
      if (domProperties.has(name)) inspect(node.right, `dom:${name}`);
      if (name === 'innerHTML' || name === 'outerHTML') html(node.right);
    }
    if (ts.isCallExpression(node)) {
      const name = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : nameOf(node.expression);
      if (name === 'setAttribute' && uiAttributes.has(nameOf(node.arguments[0])))
        inspect(node.arguments[1], `attribute:${nameOf(node.arguments[0])}`);
      if (name === 'createTextNode') inspect(node.arguments[0], 'dom:createTextNode');
      if (name === 'insertAdjacentHTML') html(node.arguments[1]);
      if (name === 'h') inspect(node.arguments[node.arguments.length === 2 ? 1 : 2], 'vue:text');
      if (buttonHelpers.has(name)) inspect(node.arguments[0], `helper:${name}`);
    }
    if (ts.isJsxAttribute(node) && uiProperties.has(nameOf(node.name))) {
      const value =
        node.initializer && ts.isJsxExpression(node.initializer)
          ? node.initializer.expression
          : node.initializer;
      inspect(value, `jsx:${nameOf(node.name)}`);
    }
    if (ts.isJsxText(node)) emit(node, 'jsx:text', normalize(node.text));
    if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)))
      inspect(node.expression, 'jsx:expression');
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

function applyExclusions(findings, exclusions, errors) {
  const counts = new Map();
  for (const finding of findings) {
    const matches = exclusions.filter((entry) =>
      ['file', 'context', 'sink', 'text'].every((key) => entry[key] === finding[key])
    );
    if (matches.length !== 1) {
      errors.push(
        `${finding.file}:${finding.line}: untranslated ${finding.sink} in ${finding.context}: ${JSON.stringify(finding.text)}${matches.length > 1 ? ' (duplicate exclusions)' : ''}`
      );
    } else counts.set(matches[0], (counts.get(matches[0]) ?? 0) + 1);
  }
  for (const entry of exclusions) {
    if (
      !['file', 'context', 'sink', 'text', 'reason'].every(
        (key) => typeof entry[key] === 'string' && entry[key].trim()
      ) ||
      !Number.isInteger(entry.occurrences) ||
      entry.occurrences < 1
    )
      errors.push(`Invalid UI exclusion: ${JSON.stringify(entry)}.`);
    if ((counts.get(entry) ?? 0) !== entry.occurrences)
      errors.push(
        `Stale UI exclusion ${entry.file} ${entry.context} ${JSON.stringify(entry.text)}: expected ${entry.occurrences}, found ${counts.get(entry) ?? 0}.`
      );
  }
}

export function inspectRepository(root, { exclusions } = {}) {
  const errors = [];
  const namespacePath = join(root, 'tests/i18n/namespaces.json');
  const namespaces = existsSync(namespacePath)
    ? JSON.parse(readFileSync(namespacePath, 'utf8'))
    : {};
  if (!existsSync(namespacePath))
    errors.push('Missing reviewed message namespace ownership policy.');
  const prefixes = new Set();
  for (const [owner, prefix] of Object.entries(namespaces)) {
    if (
      typeof prefix !== 'string' ||
      !/^[a-z][a-zA-Z0-9.-]*\.$/.test(prefix) ||
      prefixes.has(prefix)
    )
      errors.push(`Invalid or duplicate namespace for ${owner}.`);
    prefixes.add(prefix);
  }
  const declarations = new Map();
  const searchable = new Map();
  const entries = [];
  const findings = [];
  const isFree =
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name === '@domternal/source';
  const packageDirectories = readdirSync(join(root, 'packages'), { withFileTypes: true }).filter(
    (entry) => entry.isDirectory()
  );
  const rootNames = packageDirectories
    .flatMap((entry) => walkFiles(join(root, 'packages', entry.name, 'src')))
    .filter((path) => /\.[cm]?[jt]sx?$/.test(path));
  const program = ts.createProgram(rootNames, {
    noResolve: true,
    noLib: true,
    allowJs: true,
    target: ts.ScriptTarget.ESNext,
    jsx: ts.JsxEmit.Preserve,
  });
  const checker = program.getTypeChecker();
  for (const directory of packageDirectories) {
    if (!directory.isDirectory()) continue;
    const packageRoot = join(root, 'packages', directory.name);
    const manifestPath = join(packageRoot, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const packageName = JSON.parse(readFileSync(manifestPath, 'utf8')).name;
    for (const path of walkFiles(join(packageRoot, 'src')).sort()) {
      const file = relative(root, path).replaceAll('\\', '/');
      const text = readFileSync(path, 'utf8');
      if (/\.(s?css)$/.test(path)) {
        for (const match of text
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .matchAll(/\bcontent\s*:\s*(["'])(.*?)\1/g)) {
          if (hasWords(match[2]))
            findings.push({
              file,
              context: '<stylesheet>',
              sink: 'css:content',
              text: match[2],
              line: text.slice(0, match.index).split('\n').length,
            });
        }
        continue;
      }
      if (/\.(vue|html)$/.test(path)) {
        htmlLiterals(text, (sink, value) =>
          findings.push({ file, context: '<template>', sink, text: value, line: 1 })
        );
        continue;
      }
      const source = program.getSourceFile(path);
      for (const diagnostic of source.parseDiagnostics)
        errors.push(`${file}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
      declarationsIn(source, declarations, searchable, errors, file);
      const catalog = catalogIn(source, file, packageName, errors);
      entries.push(...catalog);
      findings.push(...uiLiteralsIn(source, file, checker));
    }
  }
  if (isFree) {
    for (const directory of packageDirectories) {
      const sources = walkFiles(join(root, 'packages', directory.name, 'src'), true).filter(
        (path) => /\.[cm]?[jt]sx?$/.test(path)
      );
      for (const path of sources) {
        const source =
          program.getSourceFile(path) ??
          ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
        const file = relative(root, path).replaceAll('\\', '/');
        const checkImport = (node) => {
          const call = ts.isCallExpression(node) ? node.expression : undefined;
          const requireCall =
            call &&
            (nameOf(call) === 'require' ||
              (ts.isPropertyAccessExpression(call) &&
                ((nameOf(call.expression) === 'module' && call.name.text === 'require') ||
                  (nameOf(call.expression) === 'require' && call.name.text === 'resolve'))));
          const specifier =
            ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
              ? node.moduleSpecifier
              : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
                ? node.argument.literal
                : call && (call.kind === ts.SyntaxKind.ImportKeyword || requireCall)
                  ? node.arguments[0]
                  : ts.isExternalModuleReference(node)
                    ? node.expression
                    : undefined;
          if (
            specifier &&
            ts.isStringLiteralLike(specifier) &&
            specifier.text.startsWith('@domternal-pro/')
          ) {
            errors.push(`${file}: Free source must not import Pro packages.`);
          }
          ts.forEachChild(node, checkImport);
        };
        checkImport(source);
      }
    }
  }
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) errors.push(`${entry.source}: duplicate message id ${entry.id}.`);
    ids.add(entry.id);
    const prefix = namespaces[entry.owner];
    if (typeof prefix !== 'string' || !entry.id.startsWith(prefix))
      errors.push(
        `${entry.source}: ${entry.id} is outside the reviewed namespace for ${entry.owner}.`
      );
    const declaration = declarations.get(entry.id);
    if (!declaration) errors.push(`${entry.source}: ${entry.id} is missing MessageParameters.`);
    entry.parameters = declaration ? { type: declaration.type, fields: declaration.fields } : null;
    entry.searchable = searchable.has(entry.id);
    if ((entry.searchAliases.length || entry.technicalAliases.length) && !entry.searchable)
      errors.push(`${entry.source}: ${entry.id} has aliases but is not declared searchable.`);
    const name = entry.callback?.parameters[0]?.name;
    if (name && ts.isObjectBindingPattern(name) && declaration?.fields.length) {
      for (const element of name.elements) {
        const field = nameOf(element.propertyName ?? element.name);
        if (field && !declaration.fields.some((item) => item.name === field))
          errors.push(
            `${entry.source}: ${entry.id} default callback uses undeclared parameter ${field}.`
          );
      }
    }
    delete entry.callback;
  }
  for (const [id, declaration] of declarations)
    if (!ids.has(id))
      errors.push(`${declaration.file}: declared message ${id} has no English definition.`);
  for (const [id, file] of searchable)
    if (!ids.has(id)) errors.push(`${file}: searchable message ${id} has no English definition.`);
  const exclusionPath = join(root, 'tests/i18n/exclusions.json');
  const reviewed =
    exclusions ??
    (existsSync(exclusionPath) ? JSON.parse(readFileSync(exclusionPath, 'utf8')) : []);
  applyExclusions(findings, reviewed, errors);
  return {
    inventory: {
      schemaVersion: 1,
      messages: entries.sort((a, b) => a.id.localeCompare(b.id, 'en')),
    },
    findings,
    errors,
  };
}

export function checkInventory(root, result, update = false) {
  const path = join(root, 'tests/i18n/inventory.json');
  const output = `${JSON.stringify(result.inventory, null, 2)}\n`;
  if (result.errors.length) return [...result.errors];
  if (update) {
    writeFileSync(path, output);
    return [];
  }
  if (!existsSync(path) || readFileSync(path, 'utf8') !== output)
    return [
      'Message inventory changed. Review key/default/parameter changes as public API, then run pnpm i18n:update.',
    ];
  return [];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const result = inspectRepository(root);
  const errors = checkInventory(root, result, process.argv.includes('--update'));
  if (process.argv.includes('--findings'))
    process.stdout.write(`${JSON.stringify(result.findings, null, 2)}\n`);
  else if (errors.length) {
    process.stderr.write(`${errors.join('\n')}\n`);
    process.exitCode = 1;
  } else
    process.stdout.write(
      `Localization catalog checked: ${result.inventory.messages.length} messages.\n`
    );
}
