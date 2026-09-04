#!/usr/bin/env node
/**
 * Compare a pasted result with an authored content specification, independently of exact HTML:
 * block order by identifier, block types, heading levels, list kind, marker, depth and ordinal,
 * alignment, text and semantic marks, plus the diagnostic outcome. The input is the editor
 * result the owner saves from the fixture editor, or HTML from the offline replay. A passing
 * check is analysis of one capture, never a qualification.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IDENTIFIER = /\b([BLT][0-9]{2}[a-z]?|G[0-9]{5})\b/u;
const MARKS = Object.freeze({ bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strike', subscript: 'subscript', superscript: 'superscript', highlight: 'highlight' });
const cleanupRequire = createRequire(new URL('../../packages/extension-paste-cleanup/package.json', import.meta.url));

const normalizeText = value => value.replace(/[\t\n\r ]+/gu, ' ').trim();
const empty = value => /^[\s\u00a0]*$/u.test(value);

/** Flat blocks from an editor JSON document: every textblock with its list and cell context. */
export function blocksFromEditorJSON(doc) {
  const blocks = [];
  const visit = (node, context) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const kind = node.type === 'bulletList' ? 'bullet' : 'ordered';
      const start = Number(node.attrs?.start ?? 1);
      (node.content ?? []).forEach((item, index) => {
        const list = { kind, marker: node.attrs?.listStyleType ?? null, depth: (context.list?.depth ?? 0) + 1,
          ...(kind === 'ordered' ? { ordinal: start + index } : {}) };
        (item.content ?? []).forEach((child, position) => visit(child, { ...context, list, first: position === 0 }));
      });
      return;
    }
    if (node.type === 'tableCell' || node.type === 'tableHeader') {
      for (const child of node.content ?? []) visit(child, { cell: { header: node.type === 'tableHeader' } });
      return;
    }
    if (node.type === 'paragraph' || node.type === 'heading') {
      const runs = [];
      for (const child of node.content ?? []) {
        if (child.type === 'text') runs.push({ text: child.text, marks: child.marks ?? [] });
        else if (child.type === 'hardBreak') runs.push({ text: '\n', marks: [] });
      }
      const text = runs.map(run => run.text).join('');
      const inItem = context.list !== undefined && context.first === true;
      blocks.push({
        type: empty(text) ? 'empty' : node.type === 'heading' ? 'heading' : inItem ? 'listItem' : context.cell ? 'tableCell' : 'paragraph',
        ...(node.type === 'heading' ? { level: node.attrs?.level } : {}),
        ...(inItem ? { list: context.list } : {}),
        ...(context.cell ? { cell: context.cell } : {}),
        ...(context.list !== undefined && !inItem ? { insideListItem: true } : {}),
        align: node.attrs?.textAlign ?? null, text, runs,
      });
      return;
    }
    for (const child of node.content ?? []) visit(child, context);
  };
  visit(doc, {});
  return blocks;
}

const INLINE_MARKS = Object.freeze({ strong: 'bold', b: 'bold', em: 'italic', i: 'italic', u: 'underline', s: 'strike', del: 'strike', sub: 'subscript', sup: 'superscript', mark: 'highlight' });

/** Flat blocks from normalized HTML, the same model without editor attributes. */
export function blocksFromHTML(html) {
  const { parseFragment } = cleanupRequire('parse5');
  const blocks = [];
  const attribute = (node, name) => node.attrs?.find(entry => entry.name === name)?.value;
  const inline = (node, marks, runs) => {
    for (const child of node.childNodes ?? []) {
      if (child.nodeName === '#text') runs.push({ text: child.value, marks: marks.map(type => ({ type })) });
      else if (child.nodeName === 'br') runs.push({ text: '\n', marks: [] });
      else if (child.tagName) {
        const added = [INLINE_MARKS[child.tagName], /background-color:/u.test(attribute(child, 'style') ?? '') ? 'highlight' : undefined];
        inline(child, [...marks, ...added.filter(name => name !== undefined)], runs);
      }
    }
  };
  const visit = (node, context) => {
    const tag = node.tagName;
    if (tag === 'ul' || tag === 'ol') {
      const kind = tag === 'ul' ? 'bullet' : 'ordered';
      const start = Number(attribute(node, 'start') ?? 1);
      const marker = /list-style-type:\s*([a-z-]+)/u.exec(attribute(node, 'style') ?? '')?.[1] ?? null;
      let index = 0;
      for (const item of node.childNodes ?? []) {
        if (item.tagName !== 'li') continue;
        const list = { kind, marker, depth: (context.list?.depth ?? 0) + 1, ...(kind === 'ordered' ? { ordinal: start + index } : {}) };
        let first = true;
        for (const child of item.childNodes ?? []) {
          if (!child.tagName) continue;
          visit(child, { ...context, list, first });
          first = false;
        }
        index++;
      }
      return;
    }
    if (tag === 'td' || tag === 'th') {
      for (const child of node.childNodes ?? []) visit(child, { cell: { header: tag === 'th' } });
      return;
    }
    if (tag === 'p' || /^h[1-6]$/u.test(tag ?? '')) {
      const runs = [];
      inline(node, [], runs);
      const text = runs.map(run => run.text).join('');
      const inItem = context.list !== undefined && context.first === true;
      const align = /text-align:\s*([a-z]+)/u.exec(attribute(node, 'style') ?? '')?.[1] ?? null;
      blocks.push({
        type: empty(text) ? 'empty' : tag === 'p' ? inItem ? 'listItem' : context.cell ? 'tableCell' : 'paragraph' : 'heading',
        ...(tag !== 'p' ? { level: Number(tag.slice(1)) } : {}),
        ...(inItem ? { list: context.list } : {}),
        ...(context.cell ? { cell: context.cell } : {}),
        ...(context.list !== undefined && !inItem ? { insideListItem: true } : {}),
        align, text, runs,
      });
      return;
    }
    for (const child of node.childNodes ?? []) visit(child, context);
  };
  visit(parseFragment(html), {});
  return blocks;
}

/** The authored blocks one scenario selects, with the alphabet list expanded item by item. */
export function expectedBlocks(spec, scenarioId) {
  const scenario = spec.scenarios.find(entry => entry.id === scenarioId);
  if (!scenario) throw new Error(`Unknown scenario ${scenarioId}`);
  const blocks = new Map();
  for (const document of spec.documents) for (const block of document.blocks) blocks.set(block.id, block);
  const expected = [];
  for (const id of scenario.blocks) {
    const block = blocks.get(id);
    if (!block) throw new Error(`Scenario ${scenarioId} names unknown block ${id}`);
    if (block.type === 'alphabet') {
      for (let index = 0; index < block.count; index++) {
        const text = `L${String(34 + index)} Item ${String(index + 1)}`;
        expected.push(index < 26
          ? { id: `L${String(34 + index)}`, type: 'listItem', list: { kind: 'ordered', marker: 'lower-alpha', depth: 1, ordinal: index + 1 }, text }
          : { id: `L${String(34 + index)}`, type: 'literalItem', text });
      }
    } else expected.push(block);
  }
  return { scenario, expected };
}

function compareList(expected, actual, where, problems) {
  if (!actual) { problems.push(`${where}: expected a list item`); return; }
  for (const key of ['kind', 'marker', 'depth', 'ordinal']) {
    if (expected[key] !== undefined && expected[key] !== actual[key]) {
      problems.push(`${where}: list ${key} is ${String(actual[key])}, expected ${String(expected[key])}`);
    }
  }
}

function markCoverage(block, expected, where, problems, formatting) {
  let from = -1;
  for (let count = 0; count < (expected.occurrence ?? 1); count++) {
    from = block.text.indexOf(expected.text, from + 1);
    if (from < 0) { problems.push(`${where}: text ${JSON.stringify(expected.text)} is missing`); return; }
  }
  const to = from + expected.text.length;
  let offset = 0;
  for (const run of block.runs) {
    const start = offset; offset += run.text.length;
    if (offset <= from || start >= to) continue;
    const names = run.marks.map(mark => mark.type);
    // Core keeps highlighting as a text style background; HTML keeps it as mark or background color.
    const background = run.marks.some(mark => mark.type === 'textStyle' && typeof mark.attrs?.backgroundColor === 'string');
    for (const mark of expected.marks ?? []) {
      if (!names.includes(MARKS[mark]) && !(mark === 'highlight' && background)) problems.push(`${where}: ${JSON.stringify(expected.text)} lacks ${mark}`);
    }
    if (expected.style && formatting === 'preserve') {
      const attrs = run.marks.find(mark => mark.type === 'textStyle')?.attrs ?? {};
      for (const [key, value] of Object.entries(expected.style)) {
        if (String(attrs[key] ?? '').toLowerCase() !== value.toLowerCase()) problems.push(`${where}: ${JSON.stringify(expected.text)} ${key} is ${String(attrs[key])}, expected ${value}`);
      }
    }
  }
}

/** Problems between the authored scenario and actual blocks. An empty list means the capture matches. */
export function compareBlocks(spec, scenarioId, actualBlocks, { formatting = 'preserve' } = {}) {
  const { scenario, expected } = expectedBlocks(spec, scenarioId);
  const problems = [];
  const actual = actualBlocks.filter(block => block.type !== 'empty' || expected.some(entry => entry.type === 'empty'));
  const positions = new Map();
  actual.forEach((block, index) => {
    const id = IDENTIFIER.exec(block.text)?.[1];
    if (id !== undefined) {
      if (positions.has(id)) problems.push(`${id}: appears more than once`);
      positions.set(id, index);
    }
  });
  if (expected.length === 1 && expected[0].type === 'generated') {
    // A generated document, whole or from its start: consecutive tokens without gaps or repeats.
    const ids = actual.map(block => IDENTIFIER.exec(block.text)?.[1]).filter(id => id?.startsWith('G'));
    if (ids.length === 0) problems.push('G: no generated block was pasted');
    ids.forEach((id, index) => { if (id !== `G${String(index + 1).padStart(5, '0')}`) problems.push(`G: block ${String(index + 1)} is ${String(id)}`); });
    if (ids.length > expected[0].tokens) problems.push('G: more blocks than the source document has');
    return problems;
  }
  let previous = -1;
  expected.forEach((block, order) => {
    const partialFirst = scenario.partial && order === 0;
    const partialLast = scenario.partial && order === expected.length - 1;
    const index = partialFirst ? 0 : partialLast ? actual.length - 1 : block.type === 'empty'
      ? previous + 1 : positions.get(block.id);
    const found = index === undefined ? undefined : actual[index];
    if (!found) { problems.push(`${block.id}: missing`); return; }
    if (index <= previous) problems.push(`${block.id}: out of order`);
    previous = index;
    if (partialFirst || partialLast) {
      const text = partialFirst ? scenario.partial.first : scenario.partial.last;
      if (normalizeText(found.text) !== text) problems.push(`${block.id}: partial text is ${JSON.stringify(found.text)}, expected ${JSON.stringify(text)}`);
      return;
    }
    if (block.type === 'empty') { if (found.type !== 'empty') problems.push(`${block.id}: expected an empty paragraph`); return; }
    if (block.type === 'literalItem') {
      if (found.type === 'listItem' || !normalizeText(found.text).endsWith(block.text) || normalizeText(found.text) === block.text) {
        problems.push(`${block.id}: expected a literal paragraph that keeps its visible marker`);
      }
      return;
    }
    const type = block.type === 'heading' ? 'heading' : block.type;
    if (found.type !== type) problems.push(`${block.id}: type is ${found.type}, expected ${type}`);
    if (block.level !== undefined && found.level !== block.level) problems.push(`${block.id}: heading level is ${String(found.level)}, expected ${String(block.level)}`);
    if (block.list) compareList(block.list, found.list, block.id, problems);
    // Word may leave hidden text out of the copy; both forms are recorded observations.
    const texts = block.hidden === undefined ? [block.text] : [block.text, normalizeText(block.text.replace(block.hidden, ''))];
    if (block.text !== undefined && !texts.includes(normalizeText(found.text))) {
      problems.push(`${block.id}: text is ${JSON.stringify(normalizeText(found.text))}, expected ${JSON.stringify(block.text)}`);
    }
    if (block.align && formatting === 'preserve' && found.align !== block.align) problems.push(`${block.id}: alignment is ${String(found.align)}, expected ${block.align}`);
    for (const mark of block.marks ?? []) markCoverage(found, mark, block.id, problems, formatting);
  });
  return problems;
}

/** Diagnostic outcome against the scenario: required warnings present, nothing unexpected. */
export function compareOutcome(spec, scenarioId, diagnostics) {
  const { scenario } = expectedBlocks(spec, scenarioId);
  const outcome = scenario.outcome;
  const problems = [];
  const codes = new Set(diagnostics.filter(entry => entry.severity !== 'info').map(entry => entry.code));
  const allowed = new Set([...(outcome.requiredWarnings ?? []), ...(outcome.allowedWarnings ?? []), ...(outcome.allowedErrors ?? [])]);
  for (const code of outcome.requiredWarnings ?? []) if (!codes.has(code)) problems.push(`outcome: ${code} is required but was not reported`);
  if (outcome.notice !== 'observe') for (const code of codes) if (!allowed.has(code)) problems.push(`outcome: unexpected ${code}`);
  if (outcome.notice === 'quiet' && [...codes].some(code => !allowed.has(code))) problems.push('outcome: the notice would not stay quiet');
  return problems;
}

/** Check one saved editor result `{ results, doc }` or one HTML replay against a scenario. */
export function checkScenario(spec, scenarioId, input, options = {}) {
  const blocks = typeof input.html === 'string' ? blocksFromHTML(input.html) : blocksFromEditorJSON(input.doc);
  const diagnostics = input.diagnostics ?? input.results?.at(-1)?.diagnostics ?? [];
  const problems = [...compareBlocks(spec, scenarioId, blocks, options), ...compareOutcome(spec, scenarioId, diagnostics)];
  return Object.freeze({ kind: 'native-capture-semantics', scenario: scenarioId, qualification: false, matches: problems.length === 0, problems });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [specPath, scenarioId, resultPath, formatting = 'preserve'] = process.argv.slice(2);
  if (!specPath || !scenarioId || !resultPath) {
    process.stderr.write('Usage: node semantics.mjs <content.json> <scenario> <editor-result.json> [preserve|adapt]\n');
    process.exitCode = 2;
  } else {
    const spec = JSON.parse(await readFile(specPath, 'utf8'));
    const result = JSON.parse(await readFile(resultPath, 'utf8'));
    const report = checkScenario(spec, scenarioId, result, { formatting });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.matches) process.exitCode = 1;
  }
}
