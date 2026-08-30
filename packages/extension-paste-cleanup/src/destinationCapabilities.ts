import { DOMParser } from '@domternal/pm/model';
import type { Node as PMNode, Schema } from '@domternal/pm/model';
import type { PasteDestinationFeature } from './html/destinationDemand.js';
import { officeListCapabilities } from './listCapabilities.js';

const FEATURES: readonly PasteDestinationFeature[] = Object.freeze([
  'bold', 'italic', 'underline', 'strike', 'subscript', 'superscript',
  'heading-1', 'heading-2', 'heading-3', 'heading-4', 'heading-5', 'heading-6',
  'font-family', 'font-size', 'text-color', 'highlight', 'text-align', 'line-height',
  'table', 'table-header', 'ordered-list', 'bullet-list', 'nested-list',
]);
const MARK_TAGS: Readonly<Record<string, string>> = Object.freeze({
  bold: 'strong', italic: 'em', underline: 'u', strike: 's', subscript: 'sub', superscript: 'sup',
});
interface AttributeProbe {
  readonly attribute: string;
  readonly property: string;
  readonly values: readonly [string, string];
  readonly mark: boolean;
}
const ATTRIBUTES: Readonly<Record<string, AttributeProbe>> = Object.freeze({
  'font-family': { attribute: 'fontFamily', property: 'font-family', values: ['Arial', 'Georgia'], mark: true },
  'font-size': { attribute: 'fontSize', property: 'font-size', values: ['18px', '22px'], mark: true },
  'text-color': { attribute: 'color', property: 'color', values: ['#123456', '#654321'], mark: true },
  highlight: { attribute: 'backgroundColor', property: 'background-color', values: ['#abcdef', '#fedcba'], mark: true },
  'text-align': { attribute: 'textAlign', property: 'text-align', values: ['center', 'right'], mark: false },
  'line-height': { attribute: 'lineHeight', property: 'line-height', values: ['1.5', '2'], mark: false },
});

function paragraph(node: PMNode | null, text: string): boolean {
  return node?.type.name === 'paragraph' && node.childCount === 1
    && node.firstChild?.isText === true && node.textContent === text;
}
function table(node: PMNode | null, header: boolean): boolean {
  if (node?.type.name !== 'table' || node.type.spec['tableRole'] !== 'table' || node.childCount !== 2) return false;
  for (let rowIndex = 0; rowIndex < 2; rowIndex++) {
    const row = node.child(rowIndex);
    if (row.type.name !== 'tableRow' || row.type.spec['tableRole'] !== 'row' || row.childCount !== 2) return false;
    for (let column = 0; column < 2; column++) {
      const cell = row.child(column);
      const isHeader = header && rowIndex === 0;
      if (cell.type.name !== (isHeader ? 'tableHeader' : 'tableCell')
        || cell.type.spec['tableRole'] !== (isHeader ? 'header_cell' : 'cell') || cell.childCount !== 1
        || !paragraph(cell.firstChild, ['A', 'B', 'C', 'D'][rowIndex * 2 + column] ?? '')) return false;
    }
  }
  return true;
}

/**
 * Probe the built-in destination vocabulary using constant, resource-free HTML.
 * This checks parser/schema capability, not fidelity for an arbitrary source value,
 * insertion context, custom renamed extensions or live render-option allowlists.
 * In particular, LineHeight's configurable rendering list is outside this schema-only
 * contract. No capability result is cached across operations.
 */
export function getUnsupportedDestinationFeatures(
  schema: Schema,
  document: Document,
  features: readonly PasteDestinationFeature[],
): readonly PasteDestinationFeature[] {
  // The private demand producer is bounded. Fixed vocabulary order bounds retained
  // state and probe count, deduplicating requests without retaining unknown entries.
  const requested = FEATURES.filter(feature => features.includes(feature));
  if (requested.length === 0) return Object.freeze([]);
  let parser: DOMParser;
  try { parser = DOMParser.fromSchema(schema); }
  catch { return Object.freeze(requested); }
  const parse = (html: string): readonly PMNode[] => {
    const container = document.createElement('div');
    // These strings contain only this module's constants, never source HTML or URLs.
    container.innerHTML = html;
    const slice = parser.parseSlice(container);
    const nodes: PMNode[] = [];
    slice.content.forEach(node => { node.check(); nodes.push(node); });
    return nodes;
  };
  let lists: ReturnType<typeof officeListCapabilities> | undefined;
  const supports = (feature: PasteDestinationFeature): boolean => {
    if (feature === 'ordered-list' || feature === 'bullet-list' || feature === 'nested-list') {
      if (!lists) {
        lists = { orderedLists: false, bulletLists: false, nestedLists: false };
        lists = officeListCapabilities(schema, document);
      }
      return feature === 'ordered-list' ? lists.orderedLists : feature === 'bullet-list' ? lists.bulletLists : lists.nestedLists;
    }
    const markTag = MARK_TAGS[feature];
    if (markTag) {
      const nodes = parse(`<p><${markTag}>Probe</${markTag}></p>`);
      return nodes.length === 1 && paragraph(nodes[0] ?? null, 'Probe')
        && nodes[0]?.firstChild?.marks.some(mark => mark.type.name === feature) === true;
    }
    if (feature.startsWith('heading-')) {
      const level = Number(feature.slice(-1));
      const nodes = parse(`<h${String(level)}>Probe</h${String(level)}>`);
      const node = nodes[0];
      return nodes.length === 1 && node?.type.name === 'heading' && node.attrs['level'] === level
        && node.childCount === 1 && node.firstChild?.isText === true && node.textContent === 'Probe';
    }
    const attribute = ATTRIBUTES[feature];
    if (attribute) {
      const nodes = parse(attribute.values.map((value, index) => attribute.mark
        ? `<p><span style="${attribute.property}:${value}">${String(index)}</span></p>`
        : `<p style="${attribute.property}:${value}">${String(index)}</p>`).join(''));
      return nodes.length === 2 && nodes.every((node, index) => {
        if (!paragraph(node, String(index))) return false;
        const attrs = attribute.mark ? node.firstChild?.marks.find(mark => mark.type.name === 'textStyle')?.attrs : node.attrs;
        return attrs?.[attribute.attribute] === attribute.values[index];
      });
    }
    if (feature === 'table' || feature === 'table-header') {
      const tag = feature === 'table-header' ? 'th' : 'td';
      const nodes = parse(`<table><tbody><tr><${tag}><p>A</p></${tag}><${tag}><p>B</p></${tag}></tr>`
        + '<tr><td><p>C</p></td><td><p>D</p></td></tr></tbody></table>');
      return nodes.length === 1 && table(nodes[0] ?? null, feature === 'table-header');
    }
    return false;
  };
  const unsupported = requested.filter(feature => {
    try { return !supports(feature); }
    catch { return true; }
  });
  return Object.freeze(unsupported);
}
