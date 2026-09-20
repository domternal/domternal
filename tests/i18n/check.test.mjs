import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkInventory, inspectRepository } from './check.mjs';

const catalog = `import { defineMessage as define } from '@domternal/core';
declare module '@domternal/core' {
  interface MessageParameters {
    'core.action': undefined;
    'core.count': { count: number };
    'core.help': undefined;
  }
  interface SearchableMessages { 'core.action': true; }
}
function message(id, defaultValue, description, allowEmpty = false) {
  return define({ id, defaultValue, description, allowEmpty, owner: '@domternal/core' });
}
export const messages = {
  action: define({ id: 'core.action', defaultValue: 'Action', owner: '@domternal/core', description: 'An action.', technicalAliases: ['action'] }),
  count: define({ id: 'core.count', defaultValue: ({ count }) => String(count), owner: '@domternal/core', description: 'A count.' }),
  help: message('core.help', '', 'Optional help.', true),
};
`;

function fixture(t, source = catalog, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'domternal-i18n-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'packages/core/src'), { recursive: true });
  mkdirSync(join(root, 'tests/i18n'), { recursive: true });
  writeFileSync(
    join(root, 'tests/i18n/namespaces.json'),
    JSON.stringify({ '@domternal/core': 'core.' })
  );
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@domternal/source' }));
  writeFileSync(
    join(root, 'packages/core/package.json'),
    JSON.stringify({ name: '@domternal/core' })
  );
  writeFileSync(join(root, 'packages/core/src/messages.ts'), source);
  for (const [file, content] of Object.entries(files))
    writeFileSync(join(root, 'packages/core/src', file), content);
  return root;
}
const errors = (root, options) => inspectRepository(root, options).errors.join('\n');

test('extracts aliased definitions, local factories, parameters and callback source without running code', (t) => {
  const root = fixture(t);
  const result = inspectRepository(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.inventory.messages.length, 3);
  const count = result.inventory.messages.find((message) => message.id === 'core.count');
  assert.deepEqual(count.parameters.fields, [{ name: 'count', type: 'number', optional: false }]);
  assert.match(count.default.source, /count.*String\(count\)/);
  assert.equal(
    result.inventory.messages.find((message) => message.id === 'core.help').allowEmpty,
    true
  );
  assert.equal(result.inventory.messages[0].searchable, true);
});

test('detects duplicate IDs and owner changes', (t) => {
  const duplicate = fixture(
    t,
    `${catalog}\ndefine({id:'core.action',defaultValue:'Again',owner:'wrong',description:'Duplicate.'});`
  );
  assert.match(errors(duplicate), /duplicate message id core.action/);
  assert.match(errors(duplicate), /owner must be @domternal\/core/);
});

test('rejects missing and orphan parameter or searchable declarations', (t) => {
  const missing = fixture(t, catalog.replace("    'core.action': undefined;\n", ''));
  assert.match(errors(missing), /core.action is missing MessageParameters/);
  const orphan = fixture(
    t,
    catalog
      .replace("'core.action': undefined;", "'core.action': undefined; 'core.removed': undefined;")
      .replace("'core.action': true;", "'core.action': true; 'core.removed': true;")
  );
  assert.match(errors(orphan), /declared message core.removed has no English definition/);
  assert.match(errors(orphan), /searchable message core.removed has no English definition/);
});

test('rejects a widened interface, invalid searchable marker and undeclared callback parameter', (t) => {
  const root = fixture(
    t,
    catalog
      .replace("'core.action': undefined;", "'core.action': undefined; [key: string]: unknown;")
      .replace("'core.action': true;", "'core.action': false;")
      .replace('({ count }) => String(count)', '({ missing }) => String(missing)')
  );
  assert.match(errors(root), /index signatures are forbidden/);
  assert.match(errors(root), /searchable marker core.action must be true/);
  assert.match(errors(root), /undeclared parameter missing/);
});

test('rejects empty required defaults, missing descriptions, non-string callbacks and dynamic IDs', (t) => {
  for (const [before, after, pattern] of [
    ["defaultValue: 'Action'", "defaultValue: ''", /empty required default/],
    ["description: 'An action.'", "description: ''", /needs a translator description/],
    ['({ count }) => String(count)', '({ count }) => 42', /returns a non-string literal/],
    ["message('core.help'", 'message(runtimeId', /static namespaced key/],
  ])
    assert.match(errors(fixture(t, catalog.replace(before, after))), pattern);
});

test('checks alias arrays and requires searchable declarations', (t) => {
  for (const alias of ["['']", "['action','action']", '[42]']) {
    assert.match(
      errors(fixture(t, catalog.replace("['action']", alias))),
      /unique non-empty strings/
    );
  }
  assert.match(
    errors(fixture(t, catalog.replace("'core.action': true;", ''))),
    /not declared searchable/
  );
});

test('locks the inventory so removed or renamed public keys require an explicit reviewed update', (t) => {
  const root = fixture(t);
  assert.match(checkInventory(root, inspectRepository(root)).join(), /inventory changed/);
  assert.deepEqual(checkInventory(root, inspectRepository(root), true), []);
  const original = readFileSync(join(root, 'tests/i18n/inventory.json'), 'utf8');
  assert.deepEqual(checkInventory(root, inspectRepository(root)), []);
  writeFileSync(
    join(root, 'packages/core/src/messages.ts'),
    catalog.replaceAll('core.action', 'core.renamed')
  );
  assert.match(checkInventory(root, inspectRepository(root)).join(), /inventory changed/);
  assert.equal(readFileSync(join(root, 'tests/i18n/inventory.json'), 'utf8'), original);
});

test('does not baseline UI regressions while updating inventory', (t) => {
  const root = fixture(t, catalog, { 'view.ts': "button.textContent = 'Untranslated button';" });
  assert.match(checkInventory(root, inspectRepository(root), true).join(), /Untranslated button/);
});

test('finds DOM, descriptor, JSX, Vue and helper text, including referenced const strings', (t) => {
  const root = fixture(t, catalog, {
    'view.tsx': `const COPY='Saved'; function show(){ element.textContent=COPY; element.setAttribute('aria-label','Close');
      const data={label:'Heading'}; h('span', {}, 'No matches'); createButton('Submit'); return <div title="Panel">Visible text</div>; }`,
  });
  const found = inspectRepository(root).findings;
  for (const value of [
    'Saved',
    'Close',
    'Heading',
    'No matches',
    'Submit',
    'Panel',
    'Visible text',
  ])
    assert.ok(
      found.some((entry) => entry.text === value),
      value
    );
});

test('handles Angular control expressions and catches real inline template and CSS copy', (t) => {
  const root = fixture(t, catalog, {
    'component.ts':
      'Component({template: `<div>@if (items.length > 0 || ready()) { <button aria-label="Close">Open</button> }</div>`});',
    'style.scss': ".preview::before { content: 'Preview'; }",
  });
  const result = inspectRepository(root);
  assert.ok(result.findings.some((item) => item.text === 'Close'));
  assert.ok(result.findings.some((item) => item.text === 'Open'));
  assert.ok(result.findings.some((item) => item.sink === 'css:content' && item.text === 'Preview'));
  assert.ok(!result.findings.some((item) => item.text.includes('ready')));
});

test('keeps stripped template regions as boundaries without hiding adjacent UI copy', (t) => {
  const root = fixture(t, catalog, {
    'component.ts':
      'Component({template: `<div>Before{{ count }}after</div><div><!<!-- removable -->-- <button aria-label="Visible label">Visible text</button> --></div><!-- <button aria-label="Ignored label">Ignored text</button> -->`});',
  });
  const findings = inspectRepository(root).findings;
  assert.ok(findings.some((item) => item.text === 'Before after'));
  assert.ok(!findings.some((item) => item.text === 'Beforeafter'));
  assert.ok(findings.some((item) => item.text === 'Visible label'));
  assert.ok(findings.some((item) => item.text === 'Visible text'));
  assert.ok(!findings.some((item) => item.text.includes('Ignored')));
});

test('requires exact explained exclusions and fails when they become stale', (t) => {
  const root = fixture(t, catalog, { 'view.ts': "function sample(){ button.textContent = 'A'; }" });
  const finding = inspectRepository(root).findings[0];
  const { line: _line, ...identity } = finding;
  const exclusion = {
    ...identity,
    occurrences: 1,
    reason: 'Typography color sample glyph with its own localized accessible name.',
  };
  assert.deepEqual(inspectRepository(root, { exclusions: [exclusion] }).errors, []);
  assert.match(
    errors(root, { exclusions: [{ ...exclusion, reason: '' }] }),
    /Invalid UI exclusion/
  );
  assert.match(
    errors(root, { exclusions: [{ ...exclusion, file: 'packages/**' }] }),
    /untranslated/
  );
  writeFileSync(
    join(root, 'packages/core/src/view.ts'),
    "function sample(){ button.textContent = 'B'; }"
  );
  assert.match(errors(root, { exclusions: [exclusion] }), /untranslated/);
  assert.match(errors(root, { exclusions: [exclusion] }), /Stale UI exclusion/);
});

test('excludes tests and partial consumer translations from the shipped English catalog', (t) => {
  const root = fixture(t, catalog, {
    'messages.test.ts':
      "const fixture = defineMessage({id:'custom.fixture'}); button.textContent='fixture';",
    'application.ts': "const options = {i18n:{messages:{'core.action':'Action custom'}}};",
  });
  assert.deepEqual(inspectRepository(root).errors, []);
});

test('Free catalogs reject Pro imports without requiring an installed or sibling Pro checkout', (t) => {
  for (const dependency of [
    "import { proMessages } from '@domternal-pro/core';",
    "import('@domternal-pro/core');",
    "type Pro = import('@domternal-pro/core').Pro;",
  ]) {
    const root = fixture(t, dependency + '\n' + catalog);
    assert.match(errors(root), /must not import Pro packages/);
  }
});

test('preserves meaningful whitespace inside English callback string literals', (t) => {
  const root = fixture(t, catalog.replace('({ count }) => String(count)', "({ count }) => 'A  B'"));
  const message = inspectRepository(root).inventory.messages.find(
    (entry) => entry.id === 'core.count'
  );
  assert.ok(message.default.source.includes('A  B'));
});

test('prevents a package from claiming a key outside its reviewed namespace', (t) => {
  const root = fixture(t, catalog.replaceAll('core.action', 'another.action'));
  assert.match(errors(root), /outside the reviewed namespace/);
});

test('checks direct callback result branches without treating nested helper returns as UI copy', (t) => {
  const valid = fixture(
    t,
    catalog.replace(
      '({ count }) => String(count)',
      '({ count }) => { function value() { return 42; } return String(value()); }'
    )
  );
  assert.deepEqual(inspectRepository(valid).errors, []);
  for (const value of ["''", "count ? 'one' : false", '{}']) {
    const invalid = fixture(
      t,
      catalog.replace('({ count }) => String(count)', `({ count }) => (${value})`)
    );
    assert.match(errors(invalid), /default callback returns/);
  }
});

test('checks Vue two-argument children and JSX literal expressions without classifying props as child text', (t) => {
  const root = fixture(t, catalog, {
    'children.tsx': `const label = 'Saved';
      h('span', 'Short Vue'); h('span', ['Vue array']); h('span', {class:'technical-class'});
      const ui = <><span>{'Expression text'}</span><span>{label}</span>
        <span>{ready ? 'Ready' : 'Pending'}</span><span>{visible && 'Conditional'}</span>
        <span>{['Array text']}</span></>;`,
  });
  const findings = inspectRepository(root).findings;
  for (const text of [
    'Short Vue',
    'Vue array',
    'Expression text',
    'Saved',
    'Ready',
    'Pending',
    'Conditional',
    'Array text',
  ]) {
    assert.ok(
      findings.some((finding) => finding.text === text),
      text
    );
  }
  assert.ok(!findings.some((finding) => finding.text === 'technical-class'));
});

test('Free boundary checks noncatalog files, CJS shims, declarations and dynamic imports', (t) => {
  const mutations = {
    'plain.ts': "import { something } from '@domternal-pro/core';",
    'dynamic.ts': "void import('@domternal-pro/extension-ai');",
    'shim.cjs': "module.exports = require('@domternal-pro/core');",
    'module.js': "module.require('@domternal-pro/core');",
    'resolve.mjs': "require.resolve('@domternal-pro/core');",
    'types.d.ts': "export type Foreign = import('@domternal-pro/core').Foreign;",
    'equals.cts': "import Foreign = require('@domternal-pro/core');",
    'fixture.test.ts': "import '@domternal-pro/core';",
  };
  for (const [file, source] of Object.entries(mutations)) {
    const root = fixture(t, catalog, { [file]: source });
    assert.match(errors(root), /Free source must not import Pro packages/, file);
  }
  const clean = fixture(t, catalog, {
    'plain.ts':
      "const example = \"import('@domternal-pro/core')\"; // import '@domternal-pro/core'",
  });
  assert.deepEqual(inspectRepository(clean).errors, []);
});
