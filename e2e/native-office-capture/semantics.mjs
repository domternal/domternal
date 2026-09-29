#!/usr/bin/env node
/**
 * Compare a pasted result with an authored content specification, independently of exact HTML:
 * block order by identifier, block types, heading levels, list kind, marker, depth and ordinal,
 * table, row, column and spans of each cell and its shading, alignment, line spacing, text,
 * semantic marks, links and text styles, image removal, plus the diagnostic outcome of each
 * formatting policy. The comparison is exhaustive: a block, an empty paragraph, a mark, a text
 * style, an alignment or a spacing the specification does not author for the selection is a problem. The input is the editor result the owner saves
 * from the fixture editor, HTML from the offline replay, or a capture bundle whose HTML is replayed
 * here. `--dry-run` checks a synthetic result built from the specification for every scenario, and
 * `--print` lists the texts an operator enters. A passing check is analysis of one capture, never a
 * qualification.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IDENTIFIER = /\b([BLT][0-9]{2}[a-z]?|G[BILMT][0-9]{2}[a-z]?|G[0-9]{5})\b/u;
const MARKS = Object.freeze({ bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strike', subscript: 'subscript', superscript: 'superscript', highlight: 'highlight' });
// Text styles that `adapt` removes, a highlight's background included; a result that keeps one in that policy is a finding.
const ADAPTED_STYLES = Object.freeze(['fontFamily', 'fontSize', 'color', 'backgroundColor']);
const POLICIES = Object.freeze(['preserve', 'adapt']);
const cleanupRequire = createRequire(new URL('../../packages/extension-paste-cleanup/package.json', import.meta.url));

const normalizeText = value => value.replace(/[\t\n\r ]+/gu, ' ').trim();
// A paragraph holding a no-break space is not empty: it shows no placeholder and typed text starts after the space.
const empty = value => /^[\t\n\r ]*$/u.test(value);
// Only the URL scheme of an image source is ever reported, never the address.
const scheme = source => /^([a-z][a-z0-9+.-]*):/iu.exec(source ?? '')?.[1]?.toLowerCase() ?? 'relative';

/** The cell of a table grid: its table, row and first column, counted past the cells that rows above span into it. */
function gridCells(rows) {
  const occupied = new Set();
  return rows.map((cells, rowIndex) => {
    let column = 1;
    return cells.map(({ colspan, rowspan }) => {
      while (occupied.has(`${String(rowIndex + 1)}:${String(column)}`)) column++;
      for (let row = 0; row < rowspan; row++) for (let offset = 0; offset < colspan; offset++) occupied.add(`${String(rowIndex + 1 + row)}:${String(column + offset)}`);
      const position = { row: rowIndex + 1, column };
      column += colspan;
      return position;
    });
  });
}

/** Flat blocks from an editor JSON document: every textblock and image with its list and cell context. */
export function blocksFromEditorJSON(doc) {
  const blocks = [];
  let tables = 0;
  const image = (node, context) => blocks.push({ type: 'image', text: node.attrs?.alt ?? '', src: scheme(node.attrs?.src), runs: [], align: null,
    ...(context.cell ? { cell: context.cell } : {}) });
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
    if (node.type === 'table') {
      const table = ++tables;
      const rows = (node.content ?? []).map(row => (row.content ?? []));
      const grid = gridCells(rows.map(cells => cells.map(cell => ({ colspan: Number(cell.attrs?.colspan ?? 1), rowspan: Number(cell.attrs?.rowspan ?? 1) }))));
      rows.forEach((cells, rowIndex) => cells.forEach((cellNode, cellIndex) => {
        const attrs = cellNode.attrs ?? {};
        // The background only where the schema has the attribute: a destination without it reports the loss itself.
        const cell = { header: cellNode.type === 'tableHeader', colspan: Number(attrs.colspan ?? 1), rowspan: Number(attrs.rowspan ?? 1), table,
          ...grid[rowIndex][cellIndex], ...(Object.hasOwn(attrs, 'background') ? { background: attrs.background ?? null } : {}) };
        for (const child of cellNode.content ?? []) visit(child, { cell });
      }));
      return;
    }
    if (node.type === 'image') { image(node, context); return; }
    if (node.type === 'paragraph' || node.type === 'heading') {
      const runs = [];
      const images = [];
      for (const child of node.content ?? []) {
        if (child.type === 'text') runs.push({ text: child.text, marks: child.marks ?? [] });
        else if (child.type === 'hardBreak') runs.push({ text: '\n', marks: [] });
        else if (child.type === 'image') images.push(child);
      }
      const text = runs.map(run => run.text).join('');
      const inItem = context.list !== undefined && context.first === true;
      blocks.push({
        type: empty(text) ? 'empty' : node.type === 'heading' ? 'heading' : inItem ? 'listItem' : context.cell ? 'tableCell' : 'paragraph',
        ...(node.type === 'heading' ? { level: node.attrs?.level } : {}),
        ...(inItem ? { list: context.list } : {}),
        ...(context.cell ? { cell: context.cell } : {}),
        ...(context.list !== undefined && !inItem ? { insideListItem: true } : {}),
        // The line height only where the schema has the attribute, as for the cell background.
        ...(Object.hasOwn(node.attrs ?? {}, 'lineHeight') ? { lineHeight: node.attrs.lineHeight ?? null } : {}),
        align: node.attrs?.textAlign ?? null, text, runs,
      });
      for (const child of images) image(child, context);
      return;
    }
    for (const child of node.content ?? []) visit(child, context);
  };
  visit(doc, {});
  return blocks;
}

// Elements the editor's parse places as blocks; inline content outside them opens a paragraph.
const BLOCK_TAGS = new Set(['p', 'div', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot',
  'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'details', 'summary']);
const INLINE_MARKS = Object.freeze({ strong: 'bold', b: 'bold', em: 'italic', i: 'italic', u: 'underline', s: 'strike', del: 'strike', sub: 'subscript', sup: 'superscript', mark: 'highlight' });
const STYLE_ATTRIBUTES = Object.freeze({ 'font-family': 'fontFamily', 'font-size': 'fontSize', color: 'color', 'background-color': 'backgroundColor' });

/** Flat blocks from normalized HTML, the same model; span styles become a text style mark as the editor parses them. */
export function blocksFromHTML(html) {
  const { parseFragment } = cleanupRequire('parse5');
  const blocks = [];
  const attribute = (node, name) => node.attrs?.find(entry => entry.name === name)?.value;
  const declarations = node => new Map((attribute(node, 'style') ?? '').split(';').map(entry => entry.split(':'))
    .filter(parts => parts.length >= 2).map(([name, ...value]) => [name.trim().toLowerCase(), value.join(':').trim()]));
  const withMarks = (element, marks) => {
    const next = [...marks];
    if (INLINE_MARKS[element.tagName]) next.push({ type: INLINE_MARKS[element.tagName] });
    if (element.tagName === 'a' && attribute(element, 'href') !== undefined) next.push({ type: 'link', attrs: { href: attribute(element, 'href') } });
    const style = declarations(element);
    // A transparent background draws nothing: it is neither a highlight nor a text style.
    if (style.get('background-color')?.toLowerCase() === 'transparent') style.delete('background-color');
    if (/\S/u.test(style.get('background-color') ?? '')) next.push({ type: 'highlight' });
    const attrs = {};
    for (const [property, name] of Object.entries(STYLE_ATTRIBUTES)) if (style.get(property)) attrs[name] = style.get(property);
    if (Object.keys(attrs).length > 0) {
      const index = next.findIndex(mark => mark.type === 'textStyle');
      const merged = { type: 'textStyle', attrs: { ...(index >= 0 ? next[index].attrs : {}), ...attrs } };
      if (index >= 0) next[index] = merged; else next.push(merged);
    }
    return next;
  };
  const inline = (node, marks, runs, images) => {
    for (const child of node.childNodes ?? []) {
      if (child.nodeName === '#text') runs.push({ text: child.value, marks });
      else if (child.tagName === 'br') runs.push({ text: '\n', marks: [] });
      else if (child.tagName === 'img') images.push(child);
      else if (child.tagName) inline(child, withMarks(child, marks), runs, images);
    }
  };
  const image = (node, context) => blocks.push({ type: 'image', text: attribute(node, 'alt') ?? '', src: scheme(attribute(node, 'src')), runs: [], align: null,
    ...(context.cell ? { cell: context.cell } : {}) });
  /** One textblock from its inline content, as the editor's paragraph or heading. */
  const textblock = (nodes, tag, align, context, lineHeight = null) => {
    const runs = [];
    const images = [];
    for (const child of nodes) inline({ childNodes: [child] }, [], runs, images);
    const text = runs.map(run => run.text).join('');
    const inItem = context.list !== undefined && context.first === true;
    blocks.push({
      type: empty(text) ? 'empty' : tag === 'p' ? inItem ? 'listItem' : context.cell ? 'tableCell' : 'paragraph' : 'heading',
      ...(tag !== 'p' ? { level: Number(tag.slice(1)) } : {}),
      ...(inItem ? { list: context.list } : {}),
      ...(context.cell ? { cell: context.cell } : {}),
      ...(context.list !== undefined && !inItem ? { insideListItem: true } : {}),
      lineHeight, align, text, runs,
    });
    for (const child of images) image(child, context);
  };
  const holdsBlock = node => (node.childNodes ?? []).some(child => BLOCK_TAGS.has(child.tagName) || (child.tagName && holdsBlock(child)));
  /**
   * The children of a container, where inline content outside any block becomes a paragraph of its own,
   * as the editor's parse places it: a partly selected last paragraph that a browser writes as bare spans.
   */
  const visitChildren = (node, context) => {
    let run = [];
    const flush = () => {
      if (run.some(child => child.nodeName !== '#text' || /[^\t\n\r ]/u.test(child.value))) textblock(run, 'p', null, context);
      run = [];
    };
    for (const child of node.childNodes ?? []) {
      if (child.nodeName === '#text' || (child.tagName && !BLOCK_TAGS.has(child.tagName) && child.tagName !== 'img' && !holdsBlock(child))) { run.push(child); continue; }
      flush();
      if (child.tagName) visit(child, context);
    }
    flush();
  };
  let tables = 0;
  const elements = node => (node.childNodes ?? []).filter(child => child.tagName);
  const visit = (node, context) => {
    const tag = node.tagName;
    if (tag === 'table') {
      const table = ++tables;
      const rows = elements(node).flatMap(child => (['thead', 'tbody', 'tfoot'].includes(child.tagName) ? elements(child) : [child])).filter(row => row.tagName === 'tr')
        .map(row => elements(row).filter(cell => cell.tagName === 'td' || cell.tagName === 'th'));
      const span = (cell, name) => Number(attribute(cell, name) ?? 1);
      const grid = gridCells(rows.map(cells => cells.map(cell => ({ colspan: span(cell, 'colspan'), rowspan: span(cell, 'rowspan') }))));
      rows.forEach((cells, rowIndex) => cells.forEach((cellNode, cellIndex) => {
        const background = attribute(cellNode, 'data-background') ?? declarations(cellNode).get('background-color') ?? null;
        const cell = { header: cellNode.tagName === 'th', colspan: span(cellNode, 'colspan'), rowspan: span(cellNode, 'rowspan'), table, ...grid[rowIndex][cellIndex], background };
        visitChildren(cellNode, { cell });
      }));
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      const kind = tag === 'ul' ? 'bullet' : 'ordered';
      const start = Number(attribute(node, 'start') ?? 1);
      const marker = /list-style-type:\s*([a-z-]+)/u.exec(attribute(node, 'style') ?? '')?.[1] ?? null;
      let index = 0;
      let previous;
      for (const item of node.childNodes ?? []) {
        if (item.tagName === 'ul' || item.tagName === 'ol') {
          // Google Docs nests a list directly in its parent list, after the item it belongs to.
          visit(item, { ...context, list: previous ?? { kind, marker, depth: (context.list?.depth ?? 0) + 1 } });
          continue;
        }
        if (item.tagName !== 'li') continue;
        const list = { kind, marker, depth: (context.list?.depth ?? 0) + 1, ...(kind === 'ordered' ? { ordinal: start + index } : {}) };
        previous = list;
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
      // A cell outside a table, as a bare row's: no grid position.
      const cell = { header: tag === 'th', colspan: Number(attribute(node, 'colspan') ?? 1), rowspan: Number(attribute(node, 'rowspan') ?? 1) };
      visitChildren(node, { cell });
      return;
    }
    if (tag === 'img') { image(node, context); return; }
    if (tag === 'p' || /^h[1-6]$/u.test(tag ?? '')) {
      textblock(node.childNodes ?? [], tag, /text-align:\s*([a-z]+)/u.exec(attribute(node, 'style') ?? '')?.[1] ?? null, context,
        declarations(node).get('line-height') ?? null);
      return;
    }
    // Inline content outside a paragraph or heading, in the fragment or in any other container: the editor opens a paragraph for it.
    visitChildren(node, context);
  };
  visit(parseFragment(html), {});
  return blocks;
}

/** Image references in captured HTML by URL scheme, with how many carry alt text. Addresses are never returned. */
export function imageInventory(html) {
  const { parseFragment } = cleanupRequire('parse5');
  const inventory = { count: 0, withAlt: 0, schemes: {} };
  const visit = node => {
    if (node.tagName === 'img') {
      const src = node.attrs?.find(entry => entry.name === 'src')?.value;
      const alt = node.attrs?.find(entry => entry.name === 'alt')?.value;
      const kind = src === undefined ? 'none' : scheme(src);
      inventory.count++;
      if (alt !== undefined && /\S/u.test(alt)) inventory.withAlt++;
      inventory.schemes[kind] = (inventory.schemes[kind] ?? 0) + 1;
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(parseFragment(html));
  return inventory;
}

/** The items of an alphabet block. Word shows letters past z as literal text; a source with semantic lists sets literalAfter to null. */
function alphabetItems(block) {
  const [, prefix, digits] = /^([A-Z]+)([0-9]+)$/u.exec(block.id);
  const literalAfter = block.literalAfter === undefined ? 26 : block.literalAfter;
  return Array.from({ length: block.count }, (_, index) => {
    const id = `${prefix}${String(Number(digits) + index).padStart(digits.length, '0')}`;
    const text = `${id} Item ${String(index + 1)}`;
    const style = block.textStyle === undefined ? {} : { textStyle: block.textStyle };
    return literalAfter === null || index < literalAfter
      ? { id, type: 'listItem', list: { kind: 'ordered', marker: block.marker ?? 'lower-alpha', depth: 1, ordinal: index + 1 }, text, ...style }
      : { id, type: 'literalItem', text, ...style };
  });
}

/**
 * A block as a scenario expects it: with the text style its document gives every text block, such as
 * the font of Word's Normal style, under the block's own, such as a heading style's font, size and color.
 */
export function resolvedBlock(document, block) {
  if (document.textStyle === undefined || ['empty', 'image', 'imageRun', 'generated'].includes(block.type)) return block;
  return { ...block, textStyle: { ...document.textStyle, ...block.textStyle } };
}

/** The authored blocks one scenario selects, with an alphabet list expanded item by item. */
export function expectedBlocks(spec, scenarioId) {
  const scenario = spec.scenarios.find(entry => entry.id === scenarioId);
  if (!scenario) throw new Error(`Unknown scenario ${scenarioId}`);
  const blocks = new Map();
  for (const document of spec.documents) for (const block of document.blocks) blocks.set(block.id, resolvedBlock(document, block));
  const expected = [];
  for (const id of scenario.blocks) {
    const block = blocks.get(id);
    if (!block) throw new Error(`Scenario ${scenarioId} names unknown block ${id}`);
    if (block.type === 'alphabet') expected.push(...alphabetItems(block));
    else expected.push(block);
  }
  return { scenario, expected };
}

/** Every document as an operator enters it: each block's identifier and instruction, then the exact text to paste. */
export function printSpecification(spec) {
  const lines = [];
  for (const document of spec.documents) {
    lines.push(`# ${document.title ?? document.file}${document.export ? ` (export ${document.export})` : ''}`);
    if (document.generated) lines.push(document.generated, document.docs ?? document.word);
    for (const block of document.blocks) {
      const image = block.type === 'image' ? `Image ${block.file}, alt text: ${block.alt}. ` : block.type === 'imageRun' ? `Images ${block.files}. ` : '';
      lines.push('', `${block.id}  ${image}${block.docs ?? block.word ?? block.description ?? ''}`.trimEnd());
      if (block.type === 'alphabet') lines.push(...alphabetItems(block).map(item => item.text));
      else if (typeof block.text === 'string') lines.push(block.text);
      for (const mark of block.marks ?? []) if (mark.docs ?? mark.word) lines.push(`  ${mark.text}: ${mark.docs ?? mark.word}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** The outcome of one policy: shared fields with that policy's own warnings added and its notice, if set. */
export function outcomeFor(scenario, formatting = 'preserve') {
  const { preserve, adapt, ...shared } = scenario.outcome;
  const specific = (formatting === 'adapt' ? adapt : preserve) ?? {};
  const outcome = { ...shared, ...(specific.notice === undefined ? {} : { notice: specific.notice }) };
  for (const key of ['requiredWarnings', 'allowedWarnings', 'allowedErrors']) {
    const codes = [...new Set([...(shared[key] ?? []), ...(specific[key] ?? [])])];
    if (codes.length > 0 || shared[key] !== undefined) outcome[key] = codes;
  }
  return outcome;
}

function compareList(expected, actual, where, problems) {
  if (!actual) { problems.push(`${where}: expected a list item`); return; }
  for (const key of ['kind', 'marker', 'depth', 'ordinal']) {
    if (expected[key] !== undefined && expected[key] !== actual[key]) {
      problems.push(`${where}: list ${key} is ${String(actual[key])}, expected ${String(expected[key])}`);
    }
  }
}

// The sixteen basic named colors, which Word writes by name when a color is one of them, as `color:red`.
const BASIC_COLORS = Object.freeze({ black: '#000000', silver: '#c0c0c0', gray: '#808080', white: '#ffffff', maroon: '#800000', red: '#ff0000',
  purple: '#800080', fuchsia: '#ff00ff', green: '#008000', lime: '#00ff00', olive: '#808000', yellow: '#ffff00', navy: '#000080', blue: '#0000ff',
  teal: '#008080', aqua: '#00ffff' });

/** One comparable form of a style value: the first font family unquoted, colors as hexadecimal, sizes without spaces. */
function styleValue(key, value) {
  if (value === undefined || value === null) return '';
  let text = String(value).trim().toLowerCase();
  if (key === 'fontFamily') text = text.split(',')[0].trim().replace(/^["']|["']$/gu, '');
  if (key === 'color' || key === 'backgroundColor') {
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*1(?:\.0+)?\s*)?\)$/u.exec(text);
    if (rgb) text = `#${rgb.slice(1, 4).map(part => Number(part).toString(16).padStart(2, '0')).join('')}`;
    else if (Object.hasOwn(BASIC_COLORS, text)) text = BASIC_COLORS[text];
  }
  return text.replace(/\s+/gu, '');
}

/** The range of a mark expectation in a block's text, or undefined when its text is missing. */
function markRange(block, expected) {
  let from = -1;
  for (let count = 0; count < (expected.occurrence ?? 1); count++) {
    from = block.text.indexOf(expected.text, from + 1);
    if (from < 0) return undefined;
  }
  return { from, to: from + expected.text.length };
}

/**
 * Whether the destination's schema can hold a semantic mark of the specification: its mark type, or a highlight as a
 * textStyle background. Without a destination profile, as for HTML from the offline replay, every mark is held.
 */
function destinationHolds(destination, name) {
  if (destination === undefined) return true;
  if (name === 'highlight') return destination.marks.includes('textStyle') && destination.textStyle.includes('backgroundColor');
  if (name === 'link') return destination.marks.includes('link');
  return destination.marks.includes(MARKS[name]);
}
const destinationStyle = (destination, key) => destination === undefined || (destination.marks.includes('textStyle') && destination.textStyle.includes(key));

function markCoverage(block, expected, where, problems, formatting, destination) {
  // A mark expectation can name the one policy it belongs to, for example a highlight that adapt removes.
  if (expected.formatting !== undefined && expected.formatting !== formatting) return;
  const range = markRange(block, expected);
  if (range === undefined) { problems.push(`${where}: text ${JSON.stringify(expected.text)} is missing`); return; }
  const { from, to } = range;
  let offset = 0;
  for (const run of block.runs) {
    const start = offset; offset += run.text.length;
    if (offset <= from || start >= to) continue;
    const names = run.marks.map(mark => mark.type);
    // Core keeps highlighting as a text style background; HTML keeps it as mark or background color.
    const background = run.marks.some(mark => mark.type === 'textStyle' && typeof mark.attrs?.backgroundColor === 'string');
    // A mark the destination cannot hold is expected absent; runExhaustiveness reports one that is there.
    for (const mark of expected.marks ?? []) {
      if (!destinationHolds(destination, mark)) continue;
      if (!names.includes(MARKS[mark]) && !(mark === 'highlight' && background)) problems.push(`${where}: ${JSON.stringify(expected.text)} lacks ${mark}`);
    }
    if (expected.link !== undefined && destinationHolds(destination, 'link') && !run.marks.some(mark => mark.type === 'link' && mark.attrs?.href === expected.link)) {
      problems.push(`${where}: ${JSON.stringify(expected.text)} is not a link to ${expected.link}`);
    }
    if (expected.style && formatting === 'preserve') {
      const attrs = run.marks.find(mark => mark.type === 'textStyle')?.attrs ?? {};
      for (const [key, value] of Object.entries(expected.style)) {
        if (!destinationStyle(destination, key)) continue;
        if (styleValue(key, attrs[key]) !== styleValue(key, value)) problems.push(`${where}: ${JSON.stringify(expected.text)} ${key} is ${String(attrs[key])}, expected ${value}`);
      }
    }
  }
}

/** The semantic marks a run carries, by the specification's names: a background text style is a highlight. */
function runMarks(run) {
  const names = new Set();
  for (const mark of run.marks) {
    const name = Object.keys(MARKS).find(key => MARKS[key] === mark.type);
    if (name !== undefined) names.add(name);
    if (mark.type === 'link') names.add('link');
    if (mark.type === 'textStyle' && typeof mark.attrs?.backgroundColor === 'string' && mark.attrs.backgroundColor !== '') names.add('highlight');
  }
  return names;
}

/**
 * Nothing on a block's runs that the source did not apply: every semantic mark comes from an expectation
 * covering the run, and in `preserve` every kept text style value is the one Word shows for the run, from the
 * block's style under the expectations that cover it. A kept value is checked, an absent one is not: the
 * editor's default stands in for a style the copy does not carry inline, and the notice reports real losses.
 */
function runExhaustiveness(block, found, where, problems, formatting, exhaustive = true, destination = undefined) {
  if (!exhaustive) return;
  const expectations = (block.marks ?? []).filter(mark => mark.formatting === undefined || mark.formatting === formatting)
    .map(mark => ({ mark, range: markRange(found, mark) })).filter(entry => entry.range !== undefined);
  // A literal list item's visible marker keeps the font of its list level, as Word shows the marker: only its text is checked here.
  const marker = ['literalItem', 'textOnly'].includes(block.type) && block.text !== undefined ? Math.max(0, found.text.lastIndexOf(block.text)) : 0;
  let offset = 0;
  for (const run of found.runs) {
    const start = offset; offset += run.text.length;
    if (!/\S/u.test(run.text)) continue;
    if (offset <= marker) {
      for (const name of runMarks(run)) problems.push(`${where}: its marker is ${name === 'link' ? 'a link' : name}, which the source is not`);
      continue;
    }
    const covering = expectations.filter(({ range }) => range.from < offset && start < range.to);
    const allowed = new Set(covering.flatMap(({ mark }) => [...(mark.marks ?? []), ...(mark.link === undefined ? [] : ['link']),
      ...(mark.style?.backgroundColor === undefined ? [] : ['highlight'])]));
    const label = JSON.stringify(run.text.trim().slice(0, 40));
    for (const name of runMarks(run)) {
      const shown = name === 'link' ? 'a link' : name;
      if (!destinationHolds(destination, name)) problems.push(`${where}: ${label} is ${shown}, which the destination lacks`);
      else if (!allowed.has(name)) problems.push(`${where}: ${label} is ${shown}, which the source is not`);
    }
    if (formatting !== 'preserve' || block.textStyle === undefined) continue;
    const expected = Object.assign({}, block.textStyle, ...covering.map(({ mark }) => mark.style ?? {}));
    const attrs = run.marks.find(mark => mark.type === 'textStyle')?.attrs ?? {};
    for (const key of ADAPTED_STYLES) {
      const value = attrs[key];
      if (value === undefined || value === null || value === '') continue;
      if (!destinationStyle(destination, key)) problems.push(`${where}: ${label} ${key} is ${String(value)}, which the destination lacks`);
      else if (expected[key] === undefined) problems.push(`${where}: ${label} ${key} is ${String(value)}, expected none`);
      else if (styleValue(key, value) !== styleValue(key, expected[key])) problems.push(`${where}: ${label} ${key} is ${String(value)}, expected ${String(expected[key])}`);
    }
  }
}

/** A line height as a number: a ratio, or a percentage of the font size. Undefined for a length, which no ratio can equal. */
function lineHeightNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const match = /^(\d+(?:\.\d+)?)(%?)$/u.exec(String(value).trim());
  return match === null ? undefined : Math.round(Number(match[1]) / (match[2] === '%' ? 100 : 1) * 100) / 100;
}

/** Block level formatting: alignment, line spacing and cell shading where the result can carry them, and the cell's grid position. */
function blockFormatting(block, found, where, problems, formatting, tables, exhaustive) {
  const preserve = formatting === 'preserve';
  if (preserve) {
    const expected = block.align ?? null;
    const actual = found.align === 'left' || found.align === 'start' ? null : found.align ?? null;
    if (expected === null ? actual !== null : found.align !== expected) problems.push(`${where}: alignment is ${String(found.align)}, expected ${expected ?? 'none'}`);
  } else if (found.align && !['left', 'start'].includes(found.align)) problems.push(`${where}: adapt kept alignment ${found.align}`);
  // A result without the attribute, as the default schema without LineHeight, has no spacing to compare: the notice reports it.
  if (exhaustive && Object.hasOwn(found, 'lineHeight')) {
    const expected = preserve && block.lineHeight !== undefined ? lineHeightNumber(block.lineHeight) : null;
    const actual = lineHeightNumber(found.lineHeight);
    if (actual !== expected) problems.push(`${where}: line height is ${found.lineHeight ?? 'none'}, expected ${expected === null ? 'none' : String(block.lineHeight)}`);
  }
  if (block.cell !== undefined && found.cell !== undefined) {
    if (exhaustive && Object.hasOwn(found.cell, 'background')) {
      const expected = preserve ? block.cell.background ?? null : null;
      const actual = found.cell.background ?? null;
      if ((expected === null) !== (actual === null) || (expected !== null && styleValue('backgroundColor', actual) !== styleValue('backgroundColor', expected))) {
        problems.push(`${where}: cell background is ${actual ?? 'none'}, expected ${expected ?? 'none'}`);
      }
    }
    if (block.cell.table !== undefined && found.cell.table !== undefined) {
      // Tables are matched in order of appearance: one authored table is one pasted table. A selection of part of a
      // table pastes its rows and columns from the first, so positions count from the first cell of each table.
      const known = tables.get(block.cell.table);
      const offset = { row: found.cell.row - (block.cell.row ?? found.cell.row), column: found.cell.column - (block.cell.column ?? found.cell.column) };
      if (known === undefined) {
        if ([...tables.values()].some(entry => entry.table === found.cell.table)) problems.push(`${where}: shares a table with a cell of another table`);
        tables.set(block.cell.table, { table: found.cell.table, ...offset });
      } else {
        if (known.table !== found.cell.table) problems.push(`${where}: is in another table than the cells of its own`);
        for (const key of ['row', 'column']) {
          if (block.cell[key] !== undefined && found.cell[key] !== block.cell[key] + known[key]) {
            problems.push(`${where}: ${key} is ${String(found.cell[key] - known[key])}, expected ${String(block.cell[key])}`);
          }
        }
      }
    }
  }
}

/** Whether two texts differ only where one has a no-break space and the other a space. */
const spacesDiffer = (left, right) => left !== right && left.replace(/\u00a0/gu, ' ') === right.replace(/\u00a0/gu, ' ');

/** Problems between the authored scenario and actual blocks. An empty list means the capture matches. */
export function compareBlocks(spec, scenarioId, actualBlocks, { formatting = 'preserve', destination } = {}) {
  const { scenario, expected } = expectedBlocks(spec, scenarioId);
  const problems = [];
  const actual = [...actualBlocks];
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
    const ids = actual.map(block => IDENTIFIER.exec(block.text)?.[1]).filter(id => /^G[0-9]{5}$/u.test(id ?? ''));
    if (ids.length === 0) problems.push('G: no generated block was pasted');
    ids.forEach((id, index) => { if (id !== `G${String(index + 1).padStart(5, '0')}`) problems.push(`G: block ${String(index + 1)} is ${String(id)}`); });
    if (ids.length > expected[0].tokens) problems.push('G: more blocks than the source document has');
    return problems;
  }
  // A specification that authors its documents' text style is checked for everything a paste adds, formatting included;
  // one that does not yet, such as Google Docs before its captures, for its structure, marks it names and blocks.
  const exhaustive = expected.some(block => block.textStyle !== undefined);
  // A selection that starts in a nested item: the levels above it open with one empty item each, before anything else.
  const consumed = new Set();
  const first = expected.find(block => block.type !== 'image' && block.type !== 'imageRun');
  for (let index = 0; first?.list !== undefined && index < actual.length; index++) {
    const block = actual[index];
    if (block.type !== 'empty' || block.list === undefined || block.list.depth >= first.list.depth) break;
    consumed.add(index);
  }
  // A partial selection names the blocks just outside it; their text must not arrive.
  for (const id of scenario.excluded ?? []) if (positions.has(id)) problems.push(`${id}: outside the selection but pasted`);
  const tables = new Map();
  let previous = consumed.size - 1;
  expected.forEach((block, order) => {
    if (block.type === 'image' || block.type === 'imageRun') {
      // Removal keeps the alt text in the image's place. A source may copy no alt text, and a run of images has none.
      const index = block.alt === undefined ? undefined : positions.get(block.id);
      if (index === undefined) return;
      if (index <= previous) problems.push(`${block.id}: out of order`);
      previous = index;
      consumed.add(index);
      if (actual[index].type !== 'image' && normalizeText(actual[index].text) !== block.alt) {
        problems.push(`${block.id}: alt text is ${JSON.stringify(normalizeText(actual[index].text))}, expected ${JSON.stringify(block.alt)}`);
      }
      return;
    }
    const partialFirst = scenario.partial && order === 0;
    const partialLast = scenario.partial && order === expected.length - 1;
    const index = partialFirst ? previous + 1 : partialLast ? actual.length - 1 : block.type === 'empty'
      ? previous + 1 : positions.get(block.id);
    const found = index === undefined ? undefined : actual[index];
    if (!found) { problems.push(`${block.id}: missing`); return; }
    if (block.type === 'empty' && !partialFirst && !partialLast && found.type !== 'empty') {
      // An empty paragraph that did not arrive leaves the next block in its own place.
      problems.push(`${block.id}: expected an empty paragraph`); return;
    }
    if (index <= previous) problems.push(`${block.id}: out of order`);
    previous = index;
    consumed.add(index);
    if (partialFirst || partialLast) {
      const text = partialFirst ? scenario.partial.first : scenario.partial.last;
      if (normalizeText(found.text) !== text) problems.push(`${block.id}: partial text is ${JSON.stringify(found.text)}, expected ${JSON.stringify(text)}`);
      runExhaustiveness({ textStyle: block.textStyle }, found, block.id, problems, formatting, exhaustive, destination);
      return;
    }
    if (block.type === 'empty') return;
    if (block.type === 'literalItem') {
      if (found.type === 'listItem' || !normalizeText(found.text).endsWith(block.text) || normalizeText(found.text) === block.text) {
        problems.push(`${block.id}: expected a literal paragraph that keeps its visible marker`);
      }
      runExhaustiveness(block, found, block.id, problems, formatting, exhaustive, destination);
      return;
    }
    if (block.type === 'textOnly') {
      // A profile without an expected structure: its text arrives in order, with or without a visible marker.
      if (!normalizeText(found.text).endsWith(block.text)) problems.push(`${block.id}: text is ${JSON.stringify(normalizeText(found.text))}, expected it to end with ${JSON.stringify(block.text)}`);
      runExhaustiveness(block, found, block.id, problems, formatting, exhaustive, destination);
      return;
    }
    const type = block.type === 'heading' ? 'heading' : block.type;
    if (found.type !== type) problems.push(`${block.id}: type is ${found.type}, expected ${type}`);
    if (block.level !== undefined && found.level !== block.level) problems.push(`${block.id}: heading level is ${String(found.level)}, expected ${String(block.level)}`);
    if (block.list) compareList(block.list, found.list, block.id, problems);
    for (const key of ['colspan', 'rowspan']) {
      if (block.cell?.[key] !== undefined && found.cell?.[key] !== block.cell[key]) problems.push(`${block.id}: ${key} is ${String(found.cell?.[key])}, expected ${String(block.cell[key])}`);
    }
    // Word may leave hidden text out of the copy; both forms are recorded observations.
    const texts = block.hidden === undefined ? [block.text] : [block.text, normalizeText(block.text.replace(block.hidden, ''))];
    const text = normalizeText(found.text);
    if (block.text !== undefined && !texts.includes(text)) {
      problems.push(texts.some(entry => spacesDiffer(text, entry))
        ? `${block.id}: text has a no-break space where the specification has a space, or the reverse: ${JSON.stringify(text)}`
        : `${block.id}: text is ${JSON.stringify(text)}, expected ${JSON.stringify(block.text)}`);
    }
    blockFormatting(block, found, block.id, problems, formatting, tables, exhaustive);
    if (formatting === 'adapt') {
      const kept = new Set(found.runs.flatMap(run => run.marks.filter(mark => mark.type === 'textStyle')
        .flatMap(mark => ADAPTED_STYLES.filter(key => mark.attrs?.[key]))));
      for (const key of kept) problems.push(`${block.id}: adapt kept ${key}`);
    }
    for (const mark of block.marks ?? []) markCoverage(found, mark, block.id, problems, formatting, destination);
    runExhaustiveness(block, found, block.id, problems, formatting, exhaustive, destination);
  });
  // Everything else the paste added: blocks the selection does not hold, text without an identifier, empty paragraphs.
  const excluded = new Set(scenario.excluded ?? []);
  const expectsImages = expected.some(block => block.type === 'image' || block.type === 'imageRun');
  actual.forEach((block, index) => {
    if (consumed.has(index)) return;
    const id = IDENTIFIER.exec(block.text)?.[1];
    // Without the exhaustive check an empty paragraph the scenario does not name is not compared, as a break Google Docs writes between blocks.
    if (block.type === 'empty') { if (exhaustive) problems.push(`unexpected empty paragraph at block ${String(index + 1)}`); }
    else if (block.type === 'image') { if (!expectsImages && scenario.images !== 'removed') problems.push(`unexpected image at block ${String(index + 1)}`); }
    else if (id === undefined) problems.push(`unexpected text ${JSON.stringify(normalizeText(block.text).slice(0, 40))} at block ${String(index + 1)}`);
    else if (!excluded.has(id) && !expected.some(entry => entry.id === id)) problems.push(`${id}: not in the selection but pasted`);
  });
  if (scenario.images === 'removed') {
    const kept = actual.filter(block => block.type === 'image');
    if (kept.length > 0) problems.push(`images: ${String(kept.length)} kept (${[...new Set(kept.map(block => block.src))].join(', ')}), expected removal`);
  }
  return [...new Set(problems)];
}

/**
 * Diagnostic outcome of one policy against the scenario: required warnings present, nothing unexpected. The
 * outcome is the fixture editor's; a replay without a destination, `destination: false`, cannot report what
 * only a destination reports, so those warnings are not required of it.
 */
export function compareOutcome(spec, scenarioId, diagnostics, { formatting = 'preserve', destination = true } = {}) {
  const { scenario } = expectedBlocks(spec, scenarioId);
  const outcome = outcomeFor(scenario, formatting);
  const problems = [];
  const codes = new Set(diagnostics.filter(entry => entry.severity !== 'info').map(entry => entry.code));
  const allowed = new Set([...(outcome.requiredWarnings ?? []), ...(outcome.allowedWarnings ?? []), ...(outcome.allowedErrors ?? [])]);
  for (const code of outcome.requiredWarnings ?? []) {
    if (!codes.has(code) && (destination || !code.startsWith('destination-'))) problems.push(`outcome: ${code} is required but was not reported`);
  }
  if (outcome.notice !== 'observe') for (const code of codes) if (!allowed.has(code)) problems.push(`outcome: unexpected ${code}`);
  if (outcome.notice === 'quiet' && [...codes].some(code => !allowed.has(code))) problems.push('outcome: the notice would not stay quiet');
  return problems;
}

const isCaptureBundle = input => typeof input?.harnessVersion === 'string' && typeof input?.provenance === 'object';

/** Check one saved editor result `{ results, doc }`, one HTML replay or one capture bundle against a scenario. */
export function checkScenario(spec, scenarioId, input, options = {}) {
  const formatting = options.formatting ?? 'preserve';
  const problems = [];
  let replay = input;
  let images;
  if (isCaptureBundle(input)) {
    // Replay the captured HTML exactly as the offline verifier does: no remote images, data images allowed.
    const html = input.payload?.text?.['text/html'];
    if (input.status !== 'complete' || typeof html !== 'string') throw new Error('The capture bundle is incomplete or has no text/html');
    // A separate selection of a scenario was captured under that scenario's name, which capturedAs gives.
    const recorded = expectedBlocks(spec, scenarioId).scenario.capturedAs ?? scenarioId;
    if (input.operator?.scenario !== recorded) problems.push(`capture: recorded scenario is ${String(input.operator?.scenario)}, expected ${recorded}`);
    const { normalizePasteHTML } = cleanupRequire('@domternal/extension-paste-cleanup/html');
    const result = normalizePasteHTML(html, { formatting, allowRemoteImages: false, allowDataImages: true });
    replay = { html: result.html, diagnostics: result.diagnostics };
    images = imageInventory(html);
  }
  const blocks = typeof replay.html === 'string' ? blocksFromHTML(replay.html) : blocksFromEditorJSON(replay.doc);
  const diagnostics = replay.diagnostics ?? replay.results?.at(-1)?.diagnostics ?? [];
  problems.push(...compareBlocks(spec, scenarioId, blocks, { formatting }),
    ...compareOutcome(spec, scenarioId, diagnostics, { formatting, destination: images === undefined }));
  return Object.freeze({ kind: 'native-capture-semantics', scenario: scenarioId, formatting, qualification: false,
    ...(images ? { capture: { replayed: true, images } } : {}), matches: problems.length === 0, problems });
}

/**
 * The editor result a paste that met every expectation of a scenario would save, built from the
 * specification alone. It is synthetic: it shows that the checker can express the scenario, not
 * how any source or editor behaves.
 */
export function syntheticEditorResult(spec, scenarioId, formatting = 'preserve') {
  const { scenario, expected } = expectedBlocks(spec, scenarioId);
  const preserve = formatting === 'preserve';
  const last = expected.length - 1;
  const partial = order => Boolean(scenario.partial) && (order === 0 || order === last);
  const runs = (block, text, order) => {
    if (partial(order) || !block.marks) return [{ type: 'text', text }];
    const ranges = block.marks.filter(mark => mark.formatting === undefined || mark.formatting === formatting).map(mark => {
      let from = -1;
      for (let count = 0; count < (mark.occurrence ?? 1); count++) from = text.indexOf(mark.text, from + 1);
      return { mark, from, to: from + mark.text.length };
    }).filter(range => range.from >= 0);
    const cuts = [...new Set([0, text.length, ...ranges.flatMap(range => [range.from, range.to])])].sort((a, b) => a - b);
    const pieces = [];
    for (let index = 0; index + 1 < cuts.length; index++) {
      const [from, to] = [cuts[index], cuts[index + 1]];
      const marks = [];
      for (const range of ranges.filter(entry => entry.from <= from && to <= entry.to)) {
        for (const name of range.mark.marks ?? []) marks.push({ type: MARKS[name] });
        if (range.mark.link !== undefined) marks.push({ type: 'link', attrs: { href: range.mark.link } });
        if (range.mark.style && preserve) marks.push({ type: 'textStyle', attrs: { ...range.mark.style } });
      }
      pieces.push({ type: 'text', text: text.slice(from, to), ...(marks.length > 0 ? { marks } : {}) });
    }
    return pieces;
  };
  const textblock = (block, order) => {
    const text = scenario.partial && order === 0 ? scenario.partial.first : scenario.partial && order === last ? scenario.partial.last
      : block.type === 'image' ? block.alt : block.type === 'literalItem' ? `${block.wordLabel ?? block.docsLabel ?? '•'} ${block.text}` : block.text;
    const attrs = { textAlign: preserve ? block.align ?? null : null };
    const content = text ? runs(block, text, order) : [];
    return block.type === 'heading' ? { type: 'heading', attrs: { ...attrs, level: block.level }, content } : { type: 'paragraph', attrs, content };
  };
  const listNode = (kind, marker, start) => ({ type: kind === 'bullet' ? 'bulletList' : 'orderedList',
    attrs: { listStyleType: marker ?? null, ...(kind === 'ordered' ? { start } : {}) }, content: [] });
  const build = (entries, inCell) => {
    const content = [];
    let lists = [];
    for (let position = 0; position < entries.length; position++) {
      const { block, order } = entries[position];
      if (block.cell && !inCell) {
        const run = [];
        while (position < entries.length && entries[position].block.cell?.table === block.cell.table) run.push(entries[position++]);
        position--;
        lists = [];
        content.push(table(run));
        continue;
      }
      if (block.type === 'listItem') {
        const { kind, marker, depth, ordinal } = block.list;
        lists = lists.slice(0, depth);
        for (let level = 1; level < depth; level++) {
          // A selection that starts below the first level: its ancestors are lists with one empty item.
          if (lists[level - 1]) continue;
          const node = listNode(kind, marker, 1);
          node.content.push({ type: 'listItem', content: [{ type: 'paragraph', attrs: { textAlign: null }, content: [] }] });
          if (level === 1) content.push(node); else lists[level - 2].node.content.at(-1).content.push(node);
          lists[level - 1] = { node, kind, marker, start: 1 };
        }
        let open = lists[depth - 1];
        if (!open || open.kind !== kind || open.marker !== marker || (kind === 'ordered' && ordinal !== undefined && ordinal !== open.start + open.node.content.length)) {
          const node = listNode(kind, marker, ordinal ?? 1);
          if (depth === 1) content.push(node); else lists[depth - 2].node.content.at(-1).content.push(node);
          open = { node, kind, marker, start: ordinal ?? 1 };
          lists[depth - 1] = open;
          lists = lists.slice(0, depth);
        }
        open.node.content.push({ type: 'listItem', content: [textblock(block, order)] });
        continue;
      }
      lists = [];
      if (block.type === 'empty') content.push({ type: 'paragraph', attrs: { textAlign: null }, content: [] });
      else if (block.type === 'generated') {
        for (let index = 1; index <= block.tokens; index++) content.push({ type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text: `G${String(index).padStart(5, '0')} text` }] });
      } else if (block.type !== 'imageRun' && !(block.type === 'image' && block.alt === undefined)) content.push(textblock(block, order));
    }
    return content;
  };
  const table = run => {
    const rows = new Map();
    for (const entry of run) {
      const { row, column } = entry.block.cell;
      if (!rows.has(row)) rows.set(row, new Map());
      if (!rows.get(row).has(column)) rows.get(row).set(column, { cell: entry.block.cell, entries: [] });
      rows.get(row).get(column).entries.push(entry);
    }
    const sorted = map => [...map.keys()].sort((a, b) => a - b).map(key => map.get(key));
    return { type: 'table', content: sorted(rows).map(cells => ({ type: 'tableRow', content: sorted(cells).map(({ cell, entries }) => ({
      type: 'tableCell', attrs: { colspan: cell.colspan ?? 1, rowspan: cell.rowspan ?? 1 }, content: build(entries, true) })) })) };
  };
  const diagnostics = (outcomeFor(scenario, formatting).requiredWarnings ?? []).map(code => ({ code, severity: 'warning' }));
  return { results: [{ diagnostics }], doc: { type: 'doc', content: build(expected.map((block, order) => ({ block, order })), false) } };
}

/** Check the synthetic result of every scenario under both policies. A scenario the checker cannot express fails here. */
export function dryRun(spec) {
  const results = [];
  for (const scenario of spec.scenarios) for (const formatting of POLICIES) {
    const report = checkScenario(spec, scenario.id, syntheticEditorResult(spec, scenario.id, formatting), { formatting });
    results.push(Object.freeze({ scenario: scenario.id, formatting, matches: report.matches, problems: report.problems }));
  }
  return Object.freeze({ kind: 'native-capture-semantics-dry-run', specification: spec.id, synthetic: true, qualification: false,
    matches: results.every(result => result.matches), results: Object.freeze(results) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === '--print' && args.length === 2) {
    process.stdout.write(`${printSpecification(JSON.parse(await readFile(args[1], 'utf8')))}\n`);
  } else if (args[0] === '--dry-run' && args.length === 2) {
    const report = dryRun(JSON.parse(await readFile(args[1], 'utf8')));
    process.stdout.write(`${JSON.stringify({ ...report, results: report.results.filter(result => !result.matches), checked: report.results.length }, null, 2)}\n`);
    if (!report.matches) process.exitCode = 1;
  } else {
    const [specPath, scenarioId, resultPath, formatting = 'preserve'] = args;
    if (!specPath || !scenarioId || !resultPath || !POLICIES.includes(formatting)) {
      process.stderr.write('Usage: node semantics.mjs <content.json> <scenario> <editor-result.json|capture.json> [preserve|adapt]\n'
        + '       node semantics.mjs --dry-run <content.json>\n       node semantics.mjs --print <content.json>\n');
      process.exitCode = 2;
    } else {
      const spec = JSON.parse(await readFile(specPath, 'utf8'));
      const result = JSON.parse(await readFile(resultPath, 'utf8'));
      const report = checkScenario(spec, scenarioId, result, { formatting });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (!report.matches) process.exitCode = 1;
    }
  }
}
