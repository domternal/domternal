import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bold, Document, ExtensionManager, FontFamily, FontSize, Heading, LineHeight, Paragraph, Text, TextAlign, TextColor, TextStyle } from '@domternal/core';
import type { EditorOptions } from '@domternal/core';
import { DOMParser, Schema } from '@domternal/pm/model';
import type { MarkSpec } from '@domternal/pm/model';
import { Table, TableCell, TableHeader, TableRow } from '../../extension-table/dist/index.js';
import { confirmDestinationValues } from './destinationValues.js';
import { createDestinationCheck, getUnsupportedDestinationFeatures } from './destinationCapabilities.js';
import { normalizeClipboardHTML } from './html/normalize.js';
import { parseBoundedHTML } from './html/parse.js';
import { DEFAULT_PASTE_HTML_LIMITS } from './html/normalize.js';

const managers: ExtensionManager[] = [];
afterEach(() => { for (const manager of managers.splice(0)) manager.destroy(); vi.restoreAllMocks(); });
function schemaWith(extensions: NonNullable<EditorOptions['extensions']> = []): Schema {
  const empty = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } });
  const manager = new ExtensionManager({ extensions: [Document, Paragraph, Text, ...extensions] }, { schema: empty });
  managers.push(manager); return manager.schema;
}
function confirm(schema: Schema, html: string): boolean {
  return confirmDestinationValues(schema, document, parseBoundedHTML(html, DEFAULT_PASTE_HTML_LIMITS));
}
const size: MarkSpec = { attrs: { fontSize: { default: null } }, parseDOM: [{ style: 'font-size', getAttrs: value =>
  typeof value === 'string' && ['18px', '22px'].includes(value) ? { fontSize: value } : false }],
  toDOM: mark => ['span', { style: `font-size:${String(mark.attrs['fontSize'])}` }, 0] };

describe('actual retained destination values', () => {
  it('detects a source value refused by a parser that passes both reference values', () => {
    const base = schemaWith(); const schema = new Schema({ nodes: base.spec.nodes, marks: { textStyle: size } });
    expect(getUnsupportedDestinationFeatures(schema, document, ['font-size'])).toEqual([]);
    expect(confirm(schema, '<p><span style="font-size:22px">Kept</span></p>')).toBe(true);
    expect(confirm(schema, '<p><span style="font-size:32px">Private text</span></p>')).toBe(false);
    const result = normalizeClipboardHTML('<p><span style="font-size:32px">Private text</span></p>', {}, undefined, undefined, createDestinationCheck(schema, document)).result;
    expect(result.status).toBe('cleaned'); expect(result.html).toContain('Private text');
    expect(result.diagnostics).toEqual([{ code: 'destination-formatting-unconfirmed', severity: 'warning' }]);
    expect(JSON.stringify(result.diagnostics)).not.toMatch(/Private|32px/u);
  });

  it('checks actual serializer allowlists after successful parsing and accepts configured defaults', () => {
    const restricted = schemaWith([LineHeight.configure({ lineHeights: ['1.5'] })]);
    expect(confirm(restricted, '<p style="line-height:1.5">Kept</p>')).toBe(true);
    expect(confirm(restricted, '<p style="line-height:1.7">Dropped at render</p>')).toBe(false);
    expect(confirm(schemaWith([LineHeight.configure({ defaultLineHeight: '1.7' })]), '<p style="line-height:1.7">Default</p>')).toBe(true);
    expect(confirm(schemaWith([TextAlign]), '<p style="text-align:left">Default alignment</p>')).toBe(true);
  });

  it('uses the actual paragraph or heading tag rather than assuming every block holds the same attributes', () => {
    const schema = schemaWith([Heading, TextAlign.configure({ types: ['paragraph'] })]);
    expect(confirm(schema, '<p style="text-align:center">Supported paragraph</p>')).toBe(true);
    expect(confirm(schema, '<h2 style="text-align:center">Unsupported heading</h2>')).toBe(false);
  });

  it('does not mistake a supported table cell fill for an unsupported inline highlight', () => {
    const schema = schemaWith([Table, TableRow, TableCell, TableHeader]);
    const html = '<table><tr><th style="background-color:#123456"><p>Header</p></th></tr>'
      + '<tr><td style="background-color:#abcdef"><p>Cell</p></td></tr></table>';
    expect(confirm(schema, html)).toBe(true);
    const result = normalizeClipboardHTML(html, {}, undefined, undefined, createDestinationCheck(schema, document)).result;
    expect(result.status).toBe('cleaned'); expect(result.diagnostics).toEqual([]);
    expect(result.html).toContain('background-color:#123456'); expect(result.html).toContain('background-color:#abcdef');
  });

  it('checks a concrete link destination without loading a resource or retaining source text', () => {
    const seen: Document[] = []; const base = schemaWith();
    const link: MarkSpec = { attrs: { href: {} }, parseDOM: [{ tag: 'a[href]', getAttrs: dom => {
      seen.push(dom.ownerDocument); const href = dom.getAttribute('href'); return href?.includes('blocked.invalid') ? false : { href };
    } }], toDOM: mark => ['a', { href: mark.attrs['href'] as string }, 0] };
    const schema = new Schema({ nodes: base.spec.nodes, marks: { link } });
    expect(getUnsupportedDestinationFeatures(schema, document, ['link-https'])).toEqual([]); seen.length = 0;
    expect(confirm(schema, '<p><a href="https://blocked.invalid/private">Private</a></p>')).toBe(false);
    expect(seen).toHaveLength(1); expect(seen[0]?.defaultView).toBeNull();
    expect(confirm(schema, '<p><a href="https://allowed.invalid/">Kept</a><img src="https://never.invalid/image"></p>')).toBe(true);
  });

  it('keeps canonical CSS spellings and ordinary emphasis without comparing document text', () => {
    const schema = schemaWith([TextStyle, FontSize, FontFamily, TextColor, Bold]);
    expect(confirm(schema, '<p><strong><span style="color:#abcdef;font-family:Arial;font-size:12pt">Private</span></strong></p>')).toBe(true);
    expect(confirm(schemaWith(), '<p><strong></strong><span style="font-size:32px"></span></p>')).toBe(true);
  });

  it('does not let repeated values cause repeated schema parsing', () => {
    const schema = schemaWith([TextStyle, FontSize]);
    const parse = vi.spyOn(DOMParser.prototype, 'parseSlice');
    expect(confirm(schema, '<p>' + '<span style="font-size:22px">X</span>'.repeat(1000) + '</p>')).toBe(true);
    expect(parse).toHaveBeenCalledOnce();
  });

  it('bounds distinct probes and oversized values with advisory uncertainty', () => {
    const schema = schemaWith([TextStyle, FontSize, FontFamily]); const parse = vi.spyOn(DOMParser.prototype, 'parseSlice');
    expect(confirm(schema, '<p>' + Array.from({ length: 140 }, (_, index) => `<span style="font-size:${String(index + 1)}px">X</span>`).join('') + '</p>')).toBe(false);
    expect(parse.mock.calls.length).toBeLessThanOrEqual(128);
    parse.mockClear();
    expect(confirm(schema, `<p><a href="https://example.invalid/${'a'.repeat(1100)}">X</a></p>`)).toBe(false);
    expect(parse).not.toHaveBeenCalled();
  });

  it('does not add duplicate generic warnings or treat intentional adaptation as parser loss', () => {
    const schema = schemaWith(); const check = createDestinationCheck(schema, document);
    expect(normalizeClipboardHTML('<p><strong>Missing</strong><span style="font-size:32px">Also missing</span></p>', {}, undefined, undefined, check).result.diagnostics)
      .toEqual([{ code: 'destination-formatting-unconfirmed', severity: 'warning' }]);
    expect(normalizeClipboardHTML('<p><span style="font-size:32px">Adapted</span></p>', { formatting: 'adapt' }, undefined, undefined, check).result.diagnostics.map(value => value.code))
      .toEqual(['formatting-adapted']);
  });

  it('contains custom parser and renderer failures without rejecting cleaned content', () => {
    const base = schemaWith(); const schema = new Schema({ nodes: base.spec.nodes, marks: { textStyle: { ...size,
      parseDOM: [{ style: 'font-size', getAttrs: () => { throw new Error('Host parser'); } }],
    } } });
    expect(confirm(schema, '<p><span style="font-size:22px">Kept</span></p>')).toBe(false);
  });
});
