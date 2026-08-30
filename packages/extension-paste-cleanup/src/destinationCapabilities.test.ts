import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Bold, BulletList, Document, ExtensionManager, FontFamily, FontSize, Heading, Highlight,
  Italic, LineHeight, ListItem, OrderedList, Paragraph, Strike, Subscript, Superscript,
  Text, TextAlign, TextColor, TextStyle, Underline,
} from '@domternal/core';
import type { EditorOptions } from '@domternal/core';
import { DOMParser, Schema } from '@domternal/pm/model';
import type { MarkSpec, NodeSpec } from '@domternal/pm/model';
import { getUnsupportedDestinationFeatures } from './destinationCapabilities.js';
import type { PasteDestinationFeature } from './html/destinationDemand.js';

const FEATURES: readonly PasteDestinationFeature[] = [
  'bold', 'italic', 'underline', 'strike', 'subscript', 'superscript',
  'heading-1', 'heading-2', 'heading-3', 'heading-4', 'heading-5', 'heading-6',
  'font-family', 'font-size', 'text-color', 'highlight', 'text-align', 'line-height',
  'table', 'table-header', 'ordered-list', 'bullet-list', 'nested-list',
  'ordered-list-style', 'bullet-list-style',
];
const ATTRIBUTES: readonly PasteDestinationFeature[] = ['font-family', 'font-size', 'text-color', 'highlight', 'text-align', 'line-height'];
const managers: ExtensionManager[] = [];
afterEach(() => { for (const manager of managers) manager.destroy(); managers.length = 0; vi.restoreAllMocks(); });
function schemaWith(extensions: NonNullable<EditorOptions['extensions']> = []): Schema {
  const empty = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } });
  const manager = new ExtensionManager({ extensions: [Document, Paragraph, Text, ...extensions] }, { schema: empty });
  managers.push(manager);
  return manager.schema;
}
function fullSchema(): Schema {
  return schemaWith([Bold, Italic, Underline, Strike, Subscript, Superscript, Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }), TextStyle,
    FontFamily, FontSize, TextColor, Highlight, TextAlign, LineHeight, ListItem, OrderedList, BulletList]);
}
function withTables(base: Schema, header = true): Schema {
  const cell: NodeSpec = { content: 'paragraph+', tableRole: 'cell', parseDOM: [{ tag: 'td' }] };
  const nodes: Record<string, NodeSpec> = {
    table: { group: 'block', content: 'tableRow+', tableRole: 'table', parseDOM: [{ tag: 'table' }] },
    tableRow: { content: header ? '(tableCell|tableHeader)+' : 'tableCell+', tableRole: 'row', parseDOM: [{ tag: 'tr' }] },
    tableCell: cell,
  };
  if (header) nodes['tableHeader'] = { ...cell, tableRole: 'header_cell', parseDOM: [{ tag: 'th' }] };
  return new Schema({ nodes: base.spec.nodes.append(nodes), marks: base.spec.marks });
}

describe('built-in destination parser capabilities', () => {
  it('reports the complete requested vocabulary missing from the minimal Core schema', () => {
    expect(getUnsupportedDestinationFeatures(schemaWith(), document, FEATURES)).toEqual(FEATURES);
  });

  it('accepts the real Core extension schemas and actual table content roles', () => {
    expect(getUnsupportedDestinationFeatures(withTables(fullSchema()), document, FEATURES)).toEqual([]);
  });

  it('does not treat a bare TextStyle carrier as its optional typography attributes', () => {
    expect(getUnsupportedDestinationFeatures(schemaWith([TextStyle]), document, ATTRIBUTES)).toEqual(ATTRIBUTES);
    expect(getUnsupportedDestinationFeatures(schemaWith([TextStyle, FontFamily]), document, ATTRIBUTES))
      .toEqual(['font-size', 'text-color', 'highlight', 'text-align', 'line-height']);
  });

  it('checks individual configured heading levels', () => {
    const schema = schemaWith([Heading.configure({ levels: [1, 3] })]);
    expect(getUnsupportedDestinationFeatures(schema, document, ['heading-1', 'heading-2', 'heading-3', 'heading-4', 'heading-5', 'heading-6']))
      .toEqual(['heading-2', 'heading-4', 'heading-5', 'heading-6']);
    expect(getUnsupportedDestinationFeatures(schemaWith([Heading]), document, ['heading-4', 'heading-5', 'heading-6']))
      .toEqual(['heading-5', 'heading-6']);
  });

  it('requires the actual heading level rather than a familiar node name', () => {
    const base = fullSchema();
    const spec = base.spec.nodes.get('heading');
    const schema = new Schema({ nodes: base.spec.nodes.update('heading', { ...spec, parseDOM: [{ tag: 'h2', getAttrs: () => ({ level: 1 }) }] }), marks: base.spec.marks });
    expect(getUnsupportedDestinationFeatures(schema, document, ['heading-2'])).toEqual(['heading-2']);
  });

  it('does not promote a custom renamed mark to the built-in capability', () => {
    const base = schemaWith([Bold]);
    const spec = base.spec.marks.get('bold');
    if (!spec) throw new Error('Expected Bold schema');
    const schema = new Schema({ nodes: base.spec.nodes, marks: base.spec.marks.remove('bold').addToEnd('customStrong', spec) });
    expect(getUnsupportedDestinationFeatures(schema, document, ['bold'])).toEqual(['bold']);
  });

  it('checks parent content rules that prohibit otherwise available marks', () => {
    const base = fullSchema();
    const nodes = base.spec.nodes.update('paragraph', { ...base.spec.nodes.get('paragraph'), marks: '' });
    expect(getUnsupportedDestinationFeatures(new Schema({ nodes, marks: base.spec.marks }), document, ['bold', 'font-family']))
      .toEqual(['bold', 'font-family']);
  });

  it.each(['font-family', 'font-size', 'text-color', 'highlight'] as const)('rejects silently dropped %s attributes', feature => {
    const base = fullSchema();
    const spec = base.spec.marks.get('textStyle');
    const schema = new Schema({ nodes: base.spec.nodes, marks: base.spec.marks.update('textStyle', {
      ...spec, parseDOM: [{ tag: 'span', getAttrs: () => ({}) }],
    }) });
    expect(getUnsupportedDestinationFeatures(schema, document, [feature])).toEqual([feature]);
  });

  it('uses two values so constant default attributes cannot masquerade as parsing support', () => {
    const base = fullSchema();
    const spec = base.spec.marks.get('textStyle');
    const schema = new Schema({ nodes: base.spec.nodes, marks: base.spec.marks.update('textStyle', {
      ...spec, parseDOM: [{ tag: 'span', getAttrs: () => ({ fontFamily: 'Arial', fontSize: '18px', color: '#123456', backgroundColor: '#abcdef' }) }],
    }) });
    expect(getUnsupportedDestinationFeatures(schema, document, ['font-family', 'font-size', 'text-color', 'highlight']))
      .toEqual(['font-family', 'font-size', 'text-color', 'highlight']);
  });

  it.each(['text-align', 'line-height'] as const)('requires paragraph parsing of %s rather than a default attribute', feature => {
    const base = fullSchema();
    const spec = base.spec.nodes.get('paragraph');
    const schema = new Schema({ nodes: base.spec.nodes.update('paragraph', {
      ...spec, parseDOM: [{ tag: 'p', getAttrs: () => ({ textAlign: 'center', lineHeight: '1.5' }) }],
    }), marks: base.spec.marks });
    expect(getUnsupportedDestinationFeatures(schema, document, [feature])).toEqual([feature]);
  });

  it('limits alignment and line-height evidence to paragraph parser support, not live render options', () => {
    const headingsOnly = schemaWith([Heading, TextAlign.configure({ types: ['heading'] }), LineHeight.configure({ types: ['heading'] })]);
    expect(getUnsupportedDestinationFeatures(headingsOnly, document, ['text-align', 'line-height'])).toEqual(['text-align', 'line-height']);
    const restrictedRender = schemaWith([LineHeight.configure({ lineHeights: ['1'] })]);
    expect(getUnsupportedDestinationFeatures(restrictedRender, document, ['line-height'])).toEqual([]);
  });

  it('distinguishes tables and header cells using the actual parsed structure', () => {
    const schema = withTables(schemaWith(), false);
    expect(getUnsupportedDestinationFeatures(schema, document, ['table', 'table-header'])).toEqual(['table-header']);
  });

  it('rejects familiar table node names with missing table roles', () => {
    const base = withTables(schemaWith());
    const nodes = base.spec.nodes.update('tableCell', { ...base.spec.nodes.get('tableCell'), tableRole: undefined });
    expect(getUnsupportedDestinationFeatures(new Schema({ nodes }), document, ['table', 'table-header'])).toEqual(['table', 'table-header']);
  });

  it('does not accept tables flattened by a restricted row content expression', () => {
    const base = withTables(schemaWith());
    const nodes = base.spec.nodes.update('tableRow', { ...base.spec.nodes.get('tableRow'), content: 'tableCell' });
    expect(getUnsupportedDestinationFeatures(new Schema({ nodes }), document, ['table', 'table-header'])).toEqual(['table', 'table-header']);
  });

  it('rejects a custom parse rule that maps th to ordinary cells', () => {
    const base = withTables(schemaWith());
    const nodes = base.spec.nodes.update('tableCell', { ...base.spec.nodes.get('tableCell'), parseDOM: [{ tag: 'td' }, { tag: 'th', priority: 100 }] });
    expect(getUnsupportedDestinationFeatures(new Schema({ nodes }), document, ['table', 'table-header'])).toEqual(['table-header']);
  });

  it('reuses list qualification while detecting absent starts and forbidden nesting', () => {
    const base = fullSchema();
    const nodes = base.spec.nodes.update('orderedList', { ...base.spec.nodes.get('orderedList'), parseDOM: [{ tag: 'ol', getAttrs: () => ({ start: 1 }) }] })
      .update('listItem', { ...base.spec.nodes.get('listItem'), content: 'paragraph' });
    expect(getUnsupportedDestinationFeatures(new Schema({ nodes, marks: base.spec.marks }), document, ['ordered-list', 'bullet-list', 'nested-list']))
      .toEqual(['ordered-list', 'nested-list']);
  });

  it('performs the existing list capability pass once for all requested list features', () => {
    const schema = fullSchema();
    const fromSchema = vi.spyOn(DOMParser, 'fromSchema');
    expect(getUnsupportedDestinationFeatures(schema, document, ['ordered-list', 'bullet-list', 'nested-list'])).toEqual([]);
    expect(fromSchema).toHaveBeenCalledTimes(2);
  });

  it.each(['orderedList', 'bulletList'] as const)('requires every bounded marker and the null default on %s', kind => {
    const base = fullSchema();
    const feature = kind === 'orderedList' ? 'ordered-list-style' : 'bullet-list-style';
    const tag = kind === 'orderedList' ? 'ol' : 'ul';
    const lastMarker = kind === 'orderedList' ? 'upper-roman' : 'square';
    const spec = base.spec.nodes.get(kind);
    if (!spec) throw new Error('Expected list schema');
    for (const wrong of ['constant', 'last-value', 'null-default'] as const) {
      const schema = new Schema({ nodes: base.spec.nodes.update(kind, { ...spec, parseDOM: [{ tag, getAttrs: element => {
        const marker = element.style.listStyleType || null;
        return { listStyleType: wrong === 'constant' ? (kind === 'orderedList' ? 'decimal' : 'disc')
          : wrong === 'last-value' && marker === lastMarker ? null : wrong === 'null-default' && marker === null ? lastMarker : marker };
      } }] }), marks: base.spec.marks });
      expect(getUnsupportedDestinationFeatures(schema, document, [feature])).toEqual([feature]);
    }
  });

  it('does not confuse basic list structure with explicit marker representation', () => {
    const base = fullSchema();
    const nodes = base.spec.nodes.update('orderedList', { ...base.spec.nodes.get('orderedList'), attrs: { start: { default: 1 } },
      parseDOM: [{ tag: 'ol', getAttrs: element => ({ start: Number(element.getAttribute('start') ?? '1') }) }] })
      .update('bulletList', { ...base.spec.nodes.get('bulletList'), attrs: {}, parseDOM: [{ tag: 'ul' }] });
    const schema = new Schema({ nodes, marks: base.spec.marks });
    expect(getUnsupportedDestinationFeatures(schema, document, ['ordered-list', 'bullet-list', 'nested-list'])).toEqual([]);
    expect(getUnsupportedDestinationFeatures(schema, document, ['ordered-list-style', 'bullet-list-style']))
      .toEqual(['ordered-list-style', 'bullet-list-style']);
  });

  it('reports throwing custom parsers without swallowing evidence into success', () => {
    const base = fullSchema();
    const marks = base.spec.marks.update('bold', { ...base.spec.marks.get('bold'), parseDOM: [{ tag: 'strong', getAttrs: () => { throw new Error('Host parser failed'); } }] });
    expect(getUnsupportedDestinationFeatures(new Schema({ nodes: base.spec.nodes, marks }), document, ['bold', 'italic'])).toEqual(['bold']);
  });

  it('reports all requested known features if parser construction fails', () => {
    vi.spyOn(DOMParser, 'fromSchema').mockImplementation(() => { throw new Error('Host parser failed'); });
    expect(getUnsupportedDestinationFeatures(schemaWith(), document, ['bold', 'italic'])).toEqual(['bold', 'italic']);
  });

  it('rechecks custom parser behavior on each operation', () => {
    let enabled = true;
    const base = schemaWith([Bold]);
    const mark: MarkSpec = { ...base.spec.marks.get('bold'), parseDOM: [{ tag: 'strong', getAttrs: () => enabled ? {} : false }] };
    const schema = new Schema({ nodes: base.spec.nodes, marks: base.spec.marks.update('bold', mark) });
    expect(getUnsupportedDestinationFeatures(schema, document, ['bold'])).toEqual([]);
    enabled = false;
    expect(getUnsupportedDestinationFeatures(schema, document, ['bold'])).toEqual(['bold']);
  });

  it('deduplicates known features in fixed order, freezes the result and skips empty demand', () => {
    const schema = schemaWith();
    const parser = vi.spyOn(DOMParser, 'fromSchema');
    expect(getUnsupportedDestinationFeatures(schema, document, [])).toEqual([]);
    expect(parser).not.toHaveBeenCalled();
    const result = getUnsupportedDestinationFeatures(schema, document, ['italic', 'bold', 'bold', 'unknown' as PasteDestinationFeature]);
    expect(result).toEqual(['bold', 'italic']); expect(Object.isFrozen(result)).toBe(true);
  });

  it('constructs only fixed resource-free probes for requested features', () => {
    const schema = fullSchema();
    const created: Element[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML') as { set: (this: Element, value: string) => void };
    vi.spyOn(Element.prototype, 'innerHTML', 'set').mockImplementation(function(this: Element, value: string): void {
      descriptor.set.call(this, value); created.push(this);
    });
    expect(getUnsupportedDestinationFeatures(schema, document, ['bold', 'text-color'])).toEqual([]);
    expect(created).toHaveLength(2);
    for (const element of created) {
      expect(element.querySelector('img,video,audio,iframe,object,link,script,a,[src],[href]')).toBeNull();
      expect(element.textContent).toMatch(/^(?:Probe|01)$/u);
    }
  });
});
