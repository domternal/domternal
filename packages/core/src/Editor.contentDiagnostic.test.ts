import { afterEach, describe, expect, it } from 'vitest';
import { Plugin } from '@domternal/pm/state';
import { Editor } from './Editor.js';
import { Extension } from './Extension.js';
import { Document } from './nodes/Document.js';
import { Paragraph } from './nodes/Paragraph.js';
import { Text } from './nodes/Text.js';
import { OrderedList } from './nodes/OrderedList.js';
import { BulletList } from './nodes/BulletList.js';
import type { ContentDiagnostic, ContentDiagnosticProps, EditorOptions, JSONAttribute, JSONContent } from './types/index.js';

const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const list = (marker: JSONAttribute, text = 'A', type = 'orderedList'): JSONContent => ({
  type, attrs: { listStyleType: marker }, content: [{ type: 'listItem', content: [paragraph(text)] }],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const unknown = (path: number[], value = 'bogus', nodeType = 'orderedList'): ContentDiagnostic => ({
  code: 'unknown-list-marker', nodeType, attribute: 'listStyleType', path, value,
});

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

function mount(options: Partial<EditorOptions> = {}): { editor: Editor; reports: ContentDiagnosticProps[]; order: string[] } {
  const reports: ContentDiagnosticProps[] = [];
  const order: string[] = [];
  editor = new Editor({
    extensions: [Document, Paragraph, Text, OrderedList, BulletList],
    content: '<p>start</p>',
    onContentDiagnostic: props => { reports.push(props); order.push('diagnostic'); },
    onTransaction: () => order.push('transaction'),
    onUpdate: () => order.push('update'),
    ...options,
  });
  return { editor, reports, order };
}

const markers = (ed: Editor): unknown[] => {
  const found: unknown[] = [];
  ed.state.doc.descendants(node => { if ('listStyleType' in node.attrs) found.push(node.attrs['listStyleType']); });
  return found;
};

describe('initial content with unknown list markers', () => {
  it('keeps the document, drops the marker and reports once with source content', () => {
    const errors: string[] = [];
    const { editor: ed, reports } = mount({
      content: doc(list('bogus', 'keep'), paragraph('tail')),
      onContentError: ({ error }) => errors.push(error.message),
    });
    expect(errors).toEqual([]);
    expect(ed.getText()).toBe('keep\n\ntail');
    expect(markers(ed)).toEqual([null]);
    expect(ed.getJSON().content?.[0]?.attrs?.['listStyleType']).toBeNull();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ editor: ed, source: 'content', total: 1, diagnostics: [unknown([0])] });
  });

  it('reaches listeners that extensions register before the document is built', () => {
    const seen: string[] = [];
    const Listener = Extension.create({
      name: 'diagnosticListener',
      onBeforeCreate() {
        (this.editor as unknown as Editor).on('contentDiagnostic', ({ source }) => seen.push(source));
      },
    });
    mount({ extensions: [Document, Paragraph, Text, OrderedList, BulletList, Listener], content: doc(list('bogus')) });
    expect(seen).toEqual(['content']);
  });

  it('still falls back with contentError and no diagnostic when other content is invalid', () => {
    const errors: string[] = [];
    const { editor: ed, reports } = mount({
      content: doc(list('bogus'), { type: 'nonexistent' }),
      onContentError: ({ error }) => errors.push(error.message),
    });
    expect(errors).toHaveLength(1);
    expect(ed.getText()).toBe('');
    expect(reports).toEqual([]);
  });

  it('normalizes every list but reports at most 100 diagnostics with the full total', () => {
    const lists = Array.from({ length: 150 }, (_, index) => list(`bogus-${String(index)}`));
    const { editor: ed, reports } = mount({ content: doc(...lists) });
    expect(markers(ed).every(marker => marker === null)).toBe(true);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.diagnostics).toHaveLength(100);
    expect(reports[0]?.total).toBe(150);
    expect(reports[0]?.diagnostics[99]).toEqual(unknown([99], 'bogus-99'));
  });

  it('emits nothing for known, null and absent markers', () => {
    const absent: JSONContent = { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('B')] }] };
    const { editor: ed, reports } = mount({ content: doc(list('upper-roman'), list(null), absent) });
    expect(markers(ed)).toEqual(['upper-roman', null, null]);
    expect(reports).toEqual([]);
  });
});

describe('setContent and insertContent with unknown list markers', () => {
  it('setContent succeeds and reports after the transaction and before the update', () => {
    const { editor: ed, reports, order } = mount();
    order.length = 0;
    expect(ed.setContent(doc(list('bogus', 'new')))).toBe(true);
    expect(ed.getText()).toBe('new');
    expect(markers(ed)).toEqual([null]);
    expect(order).toEqual(['transaction', 'diagnostic', 'update']);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ source: 'setContent', total: 1, diagnostics: [unknown([0])] });
    const events: string[] = [];
    ed.on('contentDiagnostic', ({ source }) => events.push(source));
    ed.commands.setContent(doc(list('weird')));
    expect(events).toEqual(['setContent']);
  });

  it('reports without an update when emitUpdate is false', () => {
    const { editor: ed, reports, order } = mount();
    order.length = 0;
    expect(ed.setContent(doc(list('bogus')), false)).toBe(true);
    expect(order).toEqual(['transaction', 'diagnostic']);
    expect(reports).toHaveLength(1);
  });

  it('never reports from a dry run', () => {
    const { editor: ed, reports } = mount();
    expect(ed.can().setContent(doc(list('bogus')))).toBe(true);
    expect(ed.can().insertContent(list('bogus'))).toBe(true);
    expect(ed.can().chain().setContent(doc(list('bogus'))).run()).toBe(true);
    expect(ed.getText()).toBe('start');
    expect(reports).toEqual([]);
  });

  it('does not report a transaction that a plugin vetoes', () => {
    const Veto = Extension.create({
      name: 'veto',
      addProseMirrorPlugins: () => [new Plugin({ filterTransaction: tr => !tr.docChanged })],
    });
    const { editor: ed, reports } = mount({ extensions: [Document, Paragraph, Text, OrderedList, BulletList, Veto] });
    ed.setContent(doc(list('bogus')));
    expect(ed.getText()).toBe('start');
    expect(reports).toEqual([]);
  });

  it('emits one report for a chain and none for a failed chain', () => {
    const { editor: ed, reports } = mount();
    expect(ed.chain().setContent(doc(list('bogus'), paragraph('end'))).insertContent(list('weird', 'B')).run()).toBe(true);
    expect(markers(ed)).toEqual([null, null]);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ source: 'setContent', total: 2, diagnostics: [unknown([0]), unknown([], 'weird')] });
    expect(ed.chain().setContent(doc(list('bogus'))).insertContent([]).run()).toBe(false);
    expect(reports).toHaveLength(1);
  });

  it('insertContent accepts a list object, an array and a document', () => {
    const { editor: ed, reports } = mount();
    expect(ed.commands.insertContent(list('bogus', 'one'))).toBe(true);
    expect(ed.commands.insertContent([list('decimal', 'two', 'bulletList'), paragraph('x')])).toBe(true);
    expect(ed.commands.insertContent(doc(paragraph('y'), list('square', 'three')))).toBe(true);
    expect(markers(ed).every(marker => marker === null)).toBe(true);
    expect(reports.map(({ source, diagnostics }) => [source, diagnostics])).toEqual([
      ['insertContent', [unknown([])]],
      ['insertContent', [unknown([0], 'decimal', 'bulletList')]],
      ['insertContent', [unknown([1], 'square')]],
    ]);
  });

  it('isolates a throwing diagnostic listener from the content change', () => {
    const { editor: ed } = mount({ onContentDiagnostic: () => { throw new Error('listener'); } });
    const seen: number[] = [];
    ed.on('contentDiagnostic', ({ total }) => seen.push(total));
    expect(ed.setContent(doc(list('bogus', 'kept')))).toBe(true);
    expect(ed.getText()).toBe('kept');
    expect(seen).toEqual([1]);
  });
});
