/**
 * The experimental attribute registry through the public entry: a node an extension adds
 * registers how loading normalizes its attribute, and every entry point follows it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  Document, Editor, Node, Paragraph, Text, createDocument, generateHTML, isSupportedAttributeValue,
  normalizeContent, pastedAttributesPlugin, registerAttributeNormalizer, resolveAttributeValue,
} from '../index.js';
import type { AttributeNormalizer, ContentDiagnostic, ContentDiagnosticProps, JSONContent } from '../index.js';

/** A whole number from 1; the configuration supports up to 3. */
const invalid = (value: unknown): boolean => !Number.isSafeInteger(value) || (value as number) < 1;
const validate = (value: unknown): void => { if (invalid(value)) throw new RangeError('Invalid size'); };
const normalizer: AttributeNormalizer = {
  code: 'unsupported-table-span',
  invalid,
  unsupported: value => invalid(value) || (value as number) > 3,
  replacement: value => (typeof value === 'number' && Number.isFinite(value) ? Math.min(3, Math.max(1, Math.floor(value))) : 1),
};
registerAttributeNormalizer(validate, normalizer);

const Box = Node.create({
  name: 'sizedBox',
  group: 'block',
  content: 'paragraph+',
  addAttributes: () => ({ size: { default: 1, validate, parseHTML: element => Number(element.getAttribute('data-size')), renderHTML: attrs => ({ 'data-size': String(attrs['size']) }) } }),
  parseHTML: () => [{ tag: 'section[data-size]' }],
  renderHTML: ({ HTMLAttributes }) => ['section', HTMLAttributes, 0],
  addProseMirrorPlugins: () => [pastedAttributesPlugin('unsupported-table-span')],
});
const extensions = [Document, Paragraph, Text, Box];
const box = (size: number): JSONContent => ({ type: 'doc', content: [{ type: 'sizedBox', attrs: { size }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'in' }] }] }] });
const size = (json: JSONContent): unknown => json.content?.[0]?.attrs?.['size'];

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

describe('registerAttributeNormalizer', () => {
  it('replaces an unsupported value while loading and reports its code', () => {
    const reports: ContentDiagnosticProps[] = [];
    editor = new Editor({ extensions, content: box(7), onContentDiagnostic: props => { reports.push(props); } });
    expect(size(editor.getJSON())).toBe(3);
    expect(reports[0]?.diagnostics).toEqual([{ code: 'unsupported-table-span', nodeType: 'sizedBox', attribute: 'size', path: [0], value: 7 }]);

    editor.commands.setContent(box(-2));
    expect(size(editor.getJSON())).toBe(1);
    expect(reports).toHaveLength(2);
  });

  it('is followed by normalizeContent, createDocument, generateHTML and the value helpers', () => {
    const diagnostics: ContentDiagnostic[] = [];
    const schema = new Editor({ extensions }).schema;
    expect(size(normalizeContent(box(2.5), schema, { onDiagnostic: diagnostic => { diagnostics.push(diagnostic); } }))).toBe(2);
    expect(createDocument(box(9), schema).firstChild?.attrs['size']).toBe(3);
    expect(generateHTML(box(5), extensions)).toBe('<section data-size="3"><p>in</p></section>');
    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual(['unsupported-table-span']);
    expect(isSupportedAttributeValue(schema, 'sizedBox', 'size', 3)).toBe(true);
    expect(isSupportedAttributeValue(schema, 'sizedBox', 'size', 4)).toBe(false);
    expect(resolveAttributeValue(schema, 'sizedBox', 'size', 4)).toBe(3);
    expect(resolveAttributeValue(schema, 'sizedBox', 'size', 2)).toBe(2);
  });

  it('lets normalizeContentAttributes migrate a stored value, filtered by its code', () => {
    editor = new Editor({ extensions, content: box(2) });
    editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'size', 8).setMeta('addToHistory', false));

    expect(editor.can().normalizeContentAttributes({ codes: ['unsafe-url'] })).toBe(false);
    expect(editor.commands.normalizeContentAttributes({ codes: ['unsupported-table-span'] })).toBe(true);
    expect(size(editor.getJSON())).toBe(3);
  });

  it('gives a pasted slice the replacement of a value validation rejects, and keeps a valid unsupported one', () => {
    const ed = new Editor({ extensions, content: '<p>x</p>' });
    editor = ed;
    const paste = (value: number): unknown => {
      ed.commands.setContent('<p>x</p>');
      const html = `<section data-pm-slice="0 0 []" data-size="${String(value)}"><p>in</p></section>`;
      ed.view.pasteHTML(html, new Event('paste', { cancelable: true }) as ClipboardEvent);
      let found: unknown;
      ed.state.doc.descendants(node => { if (node.type.name === 'sizedBox') found = node.attrs['size']; });
      return found;
    };
    expect(paste(-4)).toBe(1);
    expect(paste(5)).toBe(5);
  });
});
