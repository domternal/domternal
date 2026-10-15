import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from './Editor.js';
import { Extension } from './Extension.js';
import { Document } from './nodes/Document.js';
import { Paragraph } from './nodes/Paragraph.js';
import { Text } from './nodes/Text.js';
import { OrderedList } from './nodes/OrderedList.js';
import { registerAttributeNormalizer } from './utils/normalizedAttributes.js';
import { listLabelForKind } from './utils/listLabel.js';
import { generateHTML } from './helpers/ssr.js';
import type { ContentDiagnosticProps, JSONAttribute, JSONContent } from './types/index.js';

const editors: Editor[] = [];
afterEach(() => { editors.forEach(editor => { editor.destroy(); }); editors.length = 0; });

const invalid = (value: unknown): boolean => value !== null && listLabelForKind('orderedList', value) === null;
const validate = (value: unknown): void => { if (invalid(value)) throw new RangeError('Invalid test list label'); };
registerAttributeNormalizer(validate, { code: 'unknown-list-marker', invalid, replacement: () => null });
const Label = Extension.create({
  name: 'testGlobalValidation',
  addGlobalAttributes() {
    return [{ types: ['orderedList'], attributes: { listLabel: { default: null, validate } } }];
  },
});
const extensions = (): [typeof Document, typeof Paragraph, typeof Text, typeof OrderedList, typeof Label] => [Document, Paragraph, Text, OrderedList, Label];
const content = (value: JSONAttribute): JSONContent => ({ type: 'doc', content: [{ type: 'orderedList', attrs: { listLabel: value }, content: [
  { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item' }] }] },
] }] });

describe('global attribute validation', () => {
  it('preserves the validator identity and rejects invalid stored JSON directly', () => {
    const editor = new Editor({ extensions: extensions(), content: '<p>Test</p>' }); editors.push(editor);
    expect(editor.schema.nodes['orderedList']?.spec.attrs?.['listLabel']?.validate).toBe(validate);
    expect(() => editor.schema.nodeFromJSON(content({ kind: 'counter', format: 'css-code', prefix: '', suffix: '' }))).toThrow('Invalid test list label');
    expect(() => editor.schema.nodeFromJSON(content({ kind: 'counter', format: 'decimal', prefix: 'Section ', suffix: ')' }))).not.toThrow();
  });

  it('uses the existing normalizer on initial content, setContent and SSR', () => {
    const reports: ContentDiagnosticProps[] = [];
    const editor = new Editor({ extensions: extensions(), content: content('invalid'), onContentDiagnostic: report => reports.push(report) }); editors.push(editor);
    expect(editor.state.doc.firstChild?.attrs['listLabel']).toBeNull();
    expect(reports[0]).toMatchObject({ total: 1, diagnostics: [{ code: 'unknown-list-marker', nodeType: 'orderedList', attribute: 'listLabel' }] });
    editor.commands.setContent(content('another invalid label'));
    expect(editor.state.doc.firstChild?.attrs['listLabel']).toBeNull(); expect(reports).toHaveLength(2);
    expect(generateHTML(content('invalid'), extensions())).toBe('<ol><li><p>Item</p></li></ol>');
  });

  it('supports primitive validators and leaves an unvalidated global attribute unchanged', () => {
    const Attributes = Extension.create({
      name: 'testOtherGlobalAttributes',
      addGlobalAttributes() {
        return [{ types: ['paragraph'], attributes: { verified: { default: null, validate: 'string|null' }, legacy: { default: 'default' } } }];
      },
    });
    const editor = new Editor({ extensions: [Document, Paragraph, Text, Attributes], content: '<p>Test</p>' }); editors.push(editor);
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ verified: null, legacy: 'default' });
    expect(() => editor.schema.nodeFromJSON({ type: 'paragraph', attrs: { verified: 2 } })).toThrow();
    expect(editor.schema.nodeFromJSON({ type: 'paragraph', attrs: { verified: 'ok', legacy: { existing: true } } }).attrs)
      .toMatchObject({ verified: 'ok', legacy: { existing: true } });
  });
});
