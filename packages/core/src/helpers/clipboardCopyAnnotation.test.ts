import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOMSerializer, Fragment, Schema, Slice } from '@domternal/pm/model';
import { Plugin } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Extension } from '../Extension.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { registerClipboardCopyAnnotation } from './clipboardCopyAnnotation.js';

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors) if (!editor.isDestroyed) editor.destroy();
  editors.length = 0;
});

function mount(options: Partial<ConstructorParameters<typeof Editor>[0]> = {}): Editor {
  const editor = new Editor({ extensions: [Document, Paragraph, Text], content: '<p>First</p><p>Second</p>', ...options });
  editors.push(editor);
  return editor;
}

const mark = (fragment: DocumentFragment): void => {
  const first = fragment.firstChild;
  if (first instanceof Element) first.setAttribute('data-copy-probe', 'v1');
};

function copy(editor: Editor): HTMLElement {
  editor.commands.selectAll();
  return editor.view.serializeForClipboard(editor.state.selection.content()).dom;
}

function clipboardEvent(type: 'copy' | 'cut'): { event: Event; data: Map<string, string> } {
  const data = new Map<string, string>();
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { clearData: () => { data.clear(); }, setData: (key: string, value: string) => { data.set(key, value); }, getData: (key: string) => data.get(key) ?? '' },
  });
  return { event, data };
}

describe('experimental clipboard copy annotation', () => {
  it('leaves the copy and the resolved serializer untouched without a registration', () => {
    const editor = mount();
    expect(editor.view.someProp('clipboardSerializer')).toBeUndefined();
    expect(copy(editor).innerHTML).toBe('<p data-pm-slice="0 0 []">First</p><p>Second</p>');
  });

  it('annotates the element that carries the slice marker of a flat copy', () => {
    const editor = mount();
    registerClipboardCopyAnnotation(editor.view, mark);
    expect(copy(editor).innerHTML).toBe('<p data-copy-probe="v1" data-pm-slice="0 0 []">First</p><p>Second</p>');
  });

  it('annotates the first copied cell inside the table wrappers ProseMirror adds', () => {
    const schema = new Schema({
      nodes: {
        doc: { content: 'table+' },
        table: { content: 'row+', toDOM: () => ['table', ['tbody', 0]] },
        row: { content: 'cell+', toDOM: () => ['tr', 0] },
        cell: { content: 'paragraph+', toDOM: () => ['td', 0] },
        paragraph: { content: 'text*', toDOM: () => ['p', 0] },
        text: {},
      },
    });
    const content = { type: 'doc', content: [{ type: 'table', content: [{ type: 'row', content: [
      { type: 'cell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
    ] }] }] };
    const editor = new Editor({ schema, content });
    editors.push(editor);
    registerClipboardCopyAnnotation(editor.view, mark);
    const cell = (text: string): ReturnType<typeof schema.node> => schema.node('cell', null, [schema.node('paragraph', null, [schema.text(text)])]);
    const { dom } = editor.view.serializeForClipboard(new Slice(Fragment.from([cell('A'), cell('B')]), 1, 1));
    expect(dom.innerHTML).toBe('<table data-pm-slice="1 1 -3 []"><tbody><tr><td data-copy-probe="v1"><p>A</p></td><td><p>B</p></td></tr></tbody></table>');
  });

  it('wraps a clipboardHTMLTransform serializer without replacing its output', () => {
    const editor = mount({ clipboardHTMLTransform: html => html.replaceAll('<p>', '<p class="styled">') });
    registerClipboardCopyAnnotation(editor.view, mark);
    expect(copy(editor).innerHTML).toBe('<p class="styled" data-copy-probe="v1" data-pm-slice="0 0 []">First</p><p class="styled">Second</p>');
  });

  it('wraps a plugin clipboardSerializer and keeps its other members', () => {
    const schema = new Schema({
      nodes: {
        doc: { content: 'paragraph+' },
        paragraph: { content: 'text*', toDOM: () => ['p', { 'data-plugin': '' }, 0] },
        text: {},
      },
    });
    const serializer = DOMSerializer.fromSchema(schema);
    const Serializer = Extension.create({
      name: 'pluginClipboardSerializer',
      addProseMirrorPlugins: () => [new Plugin({ props: { clipboardSerializer: serializer } })],
    });
    const editor = mount({ extensions: [Document, Paragraph, Text, Serializer] });
    registerClipboardCopyAnnotation(editor.view, mark);
    const resolved = editor.view.someProp('clipboardSerializer');
    expect(resolved).not.toBe(serializer);
    expect(resolved?.nodes).toBe(serializer.nodes);
    expect(copy(editor).innerHTML).toBe('<p data-plugin="" data-copy-probe="v1" data-pm-slice="0 0 []">First</p><p data-plugin="">Second</p>');
    expect(editor.view.someProp('clipboardSerializer', value => value)).toBe(serializer);
  });

  it.each(['copy', 'cut'] as const)('annotates native %s data', type => {
    const editor = mount();
    registerClipboardCopyAnnotation(editor.view, mark);
    editor.commands.selectAll();
    const { event, data } = clipboardEvent(type);
    editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(data.get('text/html')).toBe('<p data-copy-probe="v1" data-pm-slice="0 0 []">First</p><p>Second</p>');
  });

  it('annotates native drag data through the same serializer', () => {
    const editor = mount();
    const annotate = vi.fn(mark);
    registerClipboardCopyAnnotation(editor.view, annotate);
    const data = new Map<string, string>();
    const event = new Event('dragstart', { bubbles: true, cancelable: true });
    // A collapsed selection skips coordinate hit testing, which jsdom does not implement.
    Object.defineProperty(event, 'dataTransfer', {
      value: { files: [], effectAllowed: '', clearData: () => { data.clear(); }, setData: (key: string, value: string) => { data.set(key, value); } },
    });
    editor.view.dom.dispatchEvent(event);
    expect(annotate).toHaveBeenCalledOnce();
    expect(data.has('text/html')).toBe(true);
  });

  it('keeps the copy when an annotator throws', () => {
    const editor = mount();
    const annotate = vi.fn(() => { throw new Error('annotation failed'); });
    registerClipboardCopyAnnotation(editor.view, annotate);
    expect(copy(editor).innerHTML).toBe('<p data-pm-slice="0 0 []">First</p><p>Second</p>');
    expect(annotate).toHaveBeenCalledOnce();
  });

  it('accepts one registration per view and disposes only its own', () => {
    const editor = mount();
    const first = vi.fn(mark);
    const second = vi.fn(mark);
    const disposeFirst = registerClipboardCopyAnnotation(editor.view, first);
    expect(() => registerClipboardCopyAnnotation(editor.view, second)).toThrow(/already has a clipboard copy annotation/);
    disposeFirst();
    const disposeSecond = registerClipboardCopyAnnotation(editor.view, second);
    disposeFirst();
    copy(editor);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    disposeSecond();
    expect(copy(editor).innerHTML).toBe('<p data-pm-slice="0 0 []">First</p><p>Second</p>');
  });

  it('keeps registrations independent between views', () => {
    const annotated = mount();
    const plain = mount();
    registerClipboardCopyAnnotation(annotated.view, mark);
    expect(copy(annotated).innerHTML).toContain('data-copy-probe');
    expect(copy(plain).innerHTML).not.toContain('data-copy-probe');
  });

  it('rejects an invalid annotator and a destroyed view', () => {
    const editor = mount();
    expect(() => registerClipboardCopyAnnotation(editor.view, 'mark' as unknown as () => void)).toThrow(TypeError);
    editor.destroy();
    expect(() => registerClipboardCopyAnnotation(editor.view, mark)).toThrow(/destroyed view/);
  });
});
