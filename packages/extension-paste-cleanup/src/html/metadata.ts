import type { Element, Properties } from 'hast';
import { readSafeStyles } from './styles.js';
import { validListStyle } from './listStyles.js';

const identifier = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
/**
 * The wrapper nodes ProseMirror's copy records as context for Domternal's
 * nodes. It records a node only while its single child is itself open, so a
 * textblock such as a paragraph, heading or details summary appears only
 * around an inline node with content, which no Domternal node is.
 */
const nodeNames = new Set(['blockquote', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'details', 'detailsContent', 'table', 'tableRow', 'tableCell', 'tableHeader', 'columns', 'column']);
/** Wrappers that hold blocks, and the block wrappers they can hold. */
const blockContainers = new Set(['blockquote', 'listItem', 'taskItem', 'detailsContent', 'column', 'tableCell', 'tableHeader']);
const blockWrappers = new Set(['blockquote', 'bulletList', 'orderedList', 'taskList', 'details', 'table', 'columns']);
/** Wrappers that hold only their own parts. */
const parts = new Map<string, ReadonlySet<string>>([
  ['bulletList', new Set(['listItem'])], ['orderedList', new Set(['listItem'])], ['taskList', new Set(['taskItem'])],
  ['table', new Set(['tableRow'])], ['tableRow', new Set(['tableCell', 'tableHeader'])],
  ['details', new Set(['detailsContent'])], ['columns', new Set(['column'])],
]);
/** Elements that are inline content, or a part of a list, table or details rather than a block. */
const inlineTags = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font', 'i', 'ins', 'kbd', 'label', 'mark', 'q', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var', 'wbr']);
const partTags = new Set(['li', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'caption', 'col', 'colgroup', 'summary']);
const types = new Set(['taskList', 'taskItem', 'details', 'detailsContent', 'math-inline', 'math-block', 'mention', 'emoji', 'columns', 'column']);
const reservedIDs = new Set(['__proto__', 'prototype', 'constructor', 'window', 'document', 'location', 'forms', 'images', 'scripts', 'attributes', 'children']);

function safeID(value: unknown): value is string {
  return typeof value === 'string' && identifier.test(value) && !reservedIDs.has(value.toLowerCase());
}

function color(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = readSafeStyles(`color:${value}`);
  return !parsed.removed && parsed.styles.size === 1 && parsed.styles.get('color') === value;
}

function contextAttribute(key: string, value: unknown, nodeName?: string): boolean {
  if (key === 'listStyleType') {
    const tag = nodeName === 'orderedList' ? 'ol' : nodeName === 'bulletList' ? 'ul' : '';
    return tag !== '' && (value === null || validListStyle(tag, value));
  }
  if (!['id', 'start', 'order', 'colspan', 'rowspan', 'checked', 'open', 'textAlign', 'verticalAlign', 'background', 'colwidth', 'width'].includes(key)) return false;
  if (value === null) return true;
  if (key === 'id') return safeID(value);
  if (['start', 'order'].includes(key)) return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10_000;
  if (['colspan', 'rowspan'].includes(key)) return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 1_000;
  if (key === 'checked' || key === 'open') return typeof value === 'boolean';
  if (key === 'textAlign') return typeof value === 'string' && ['left', 'right', 'center', 'justify', 'start', 'end'].includes(value);
  if (key === 'verticalAlign') return typeof value === 'string' && ['top', 'middle', 'bottom'].includes(value);
  if (key === 'background') return color(value);
  if (key === 'colwidth') return Array.isArray(value) && value.length <= 1_000 && value.every(width => Number.isSafeInteger(width) && Number(width) >= 0 && Number(width) <= 10_000);
  if (key === 'width') return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100;
  return false;
}

/** Whether the wrapper `outer` can hold the wrapper `inner` directly. */
function holds(outer: string, inner: string): boolean {
  return blockContainers.has(outer) ? blockWrappers.has(inner) : parts.get(outer)?.has(inner) === true;
}

/** Whether the innermost wrapper can hold the element ProseMirror parses first inside it. */
function holdsTarget(inner: string, target: Element): boolean {
  const tag = target.tagName;
  const { dataType } = target.properties;
  const detailsContent = target.properties['dataDetailsContent'] !== undefined || dataType === 'detailsContent';
  if (inner === 'bulletList' || inner === 'orderedList' || inner === 'taskList') return tag === 'li';
  if (inner === 'table') return tag === 'tr';
  if (inner === 'tableRow') return tag === 'td' || tag === 'th';
  if (inner === 'details') return tag === 'summary' || detailsContent;
  if (inner === 'columns') return dataType === 'column';
  return !inlineTags.has(tag) && !partTags.has(tag) && !detailsContent && dataType !== 'column';
}

/**
 * Clipboard slice context is data, never a trust marker or a way to bypass attribute checks.
 * A context is kept only when ProseMirror's copy could have written it: known wrappers that
 * each hold the next, and, when `target` is the element ProseMirror parses first, an innermost
 * wrapper that can hold it. Anything else is refused as a whole, as prosemirror-view would
 * otherwise nest the pasted content in wrappers that cannot hold it.
 * `drop` removes context attributes that the caller's formatting policy does not keep.
 */
export function cleanSliceContext(value: unknown, drop?: ReadonlySet<string>, target?: Element): string | undefined {
  if (typeof value !== 'string' || value.length > 16_384) return undefined;
  const match = /^(\d{1,3}) (\d{1,3})(?: (-\d{1,3}))? (\[[\s\S]*\])$/.exec(value);
  if (match === null || Number(match[1]) > 128 || Number(match[2]) > 128 || Math.abs(Number(match[3] ?? 0)) > 128) return undefined;
  let context: unknown;
  try { context = JSON.parse(match[4] ?? '[]') as unknown; } catch { return undefined; }
  if (!Array.isArray(context) || context.length > 128 || context.length % 2 !== 0) return undefined;
  const clean: unknown[] = [];
  for (let index = 0; index < context.length; index += 2) {
    const name: unknown = context[index];
    const attributes: unknown = context[index + 1];
    if (typeof name !== 'string' || !nodeNames.has(name)) return undefined;
    const outer = clean.at(-2);
    if (typeof outer === 'string' && !holds(outer, name)) return undefined;
    if (attributes === null) { clean.push(name, null); continue; }
    if (typeof attributes !== 'object' || Array.isArray(attributes)) return undefined;
    const filtered: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(attributes)) {
      if (drop?.has(key) !== true && contextAttribute(key, entry, name)) filtered[key] = entry;
    }
    clean.push(name, filtered);
  }
  const inner = clean.at(-2);
  if (target !== undefined && typeof inner === 'string' && !holdsTarget(inner, target)) return undefined;
  return `${match[1] ?? '0'} ${match[2] ?? '0'}${match[3] === undefined ? '' : ` ${match[3]}`} ${JSON.stringify(clean)}`;
}

/**
 * Preserve supported editor semantics through validation, including external lookalikes.
 * Slice context is not copied here: only the verified anchor receives it again.
 */
export function cleanMetadata(original: Properties): Properties {
  const clean: Properties = {};
  if (safeID(original.id)) clean.id = original.id;
  if (typeof original.dataType === 'string' && types.has(original.dataType)) clean.dataType = original.dataType;
  if (original['dataDetailsContent'] !== undefined) clean['dataDetailsContent'] = '';
  if (['true', 'false', ''].includes(String(original['dataChecked']))) clean['dataChecked'] = original['dataChecked'] === 'false' ? 'false' : 'true';
  for (const key of ['dataTextColor', 'dataBgColor']) {
    const value = original[key];
    if (typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value)) clean[key] = value;
  }
  if (color(original['dataBackground'])) clean['dataBackground'] = original['dataBackground'];
  if (['left', 'right', 'center', 'justify'].includes(String(original['dataTextAlign']))) clean['dataTextAlign'] = original['dataTextAlign'];
  if (['top', 'middle', 'bottom'].includes(String(original['dataVerticalAlign']))) clean['dataVerticalAlign'] = original['dataVerticalAlign'];
  if (['left', 'center', 'right'].includes(String(original['dataAlign']))) clean['dataAlign'] = original['dataAlign'];
  const widths = original['dataColwidth'];
  if (typeof widths === 'string' && widths.length <= 6_000 && /^\d+(?:,\d+)*$/.test(widths)) {
    const values = widths.split(',').map(Number);
    if (contextAttribute('colwidth', values)) clean['dataColwidth'] = values.join(',');
  }
  const threads = original['dataThreadIds'];
  if (typeof threads === 'string' && threads.length <= 4_096) {
    const ids = threads.split(/\s+/).filter(Boolean);
    if (ids.length <= 100 && ids.every(safeID)) clean['dataThreadIds'] = ids.join(' ');
  }
  for (const key of ['dataLatex', 'dataId', 'dataLabel', 'dataMentionType', 'dataName', 'dataEmoji']) {
    const value = original[key];
    if (typeof value === 'string' && value.length <= 4_096) clean[key] = value;
  }
  return clean;
}
