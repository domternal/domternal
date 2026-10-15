import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BulletList, Document, Editor, Extension, Heading, History, LineHeight, ListItem, Paragraph, Text, TextAlign, UniqueID,
} from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { Plugin, TextSelection } from '@domternal/pm/state';
import { undoDepth } from '@domternal/pm/history';
import { SmartPaste } from '../../extension-block-controls/dist/index.js';
import { Image } from '../../extension-image/dist/index.js';
import { Table, TableCell, TableHeader, TableRow } from '../../extension-table/dist/index.js';
import { PasteCleanup } from './index.js';
import type { PasteCleanupOptions } from './index.js';
import { pasteCleanupKey } from './operations.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const targetStyle = 'text-align:right;line-height:1.5';
const sourceStyle = 'text-align:center;line-height:1.7';
const source = `<p style="${sourceStyle}">First</p><p style="text-align:justify;line-height:2">Second</p>`;
const empty = `<p style="${targetStyle}"></p>`;

function mount(content = empty, options: PasteCleanupOptions = {}, extra: AnyExtension[] = []): Editor {
  const editor = new Editor({ content, extensions: [
    Document, Paragraph, Text, Heading, History, BulletList, ListItem, TextAlign,
    LineHeight.configure({ lineHeights: [] }), ...extra, PasteCleanup.configure(options),
  ] });
  editors.push(editor);
  editor.view.setProps({ handleScrollToSelection: () => true });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atStart(editor.state.doc)));
  return editor;
}

function paste(editor: Editor, html: string, route: 'native' | 'programmatic' = 'native', files: readonly File[] = []): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: [{ kind: 'string', type: 'text/html', getAsFile: () => null },
        ...files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file }))],
      files, getData: (type: string) => type === 'text/html' ? html : '',
    },
  });
  if (route === 'programmatic') editor.view.pasteHTML(html, event as ClipboardEvent);
  else { editor.view.dom.dispatchEvent(event); expect(event.defaultPrevented).toBe(true); }
}

function firstParagraph(editor: Editor): { attrs: Record<string, unknown>; text: string } {
  let first: { attrs: Record<string, unknown>; text: string } | undefined;
  editor.state.doc.descendants(node => {
    if (node.type.name === 'paragraph') first ??= { attrs: node.attrs, text: node.textContent };
  });
  if (!first) throw new Error('Expected a paragraph');
  return first;
}

describe('the first external pasted paragraph', () => {
  for (const route of ['native', 'programmatic'] as const) for (const smart of [false, true]) {
    it(`preserves explicit alignment and spacing in an empty paragraph through ${route}, SmartPaste=${String(smart)}`, () => {
      const editor = mount(empty, {}, smart ? [SmartPaste] : []);
      const before = editor.getJSON();
      const selection = editor.state.selection.toJSON();
      paste(editor, source, route);
      expect(firstParagraph(editor)).toMatchObject({ attrs: { textAlign: 'center', lineHeight: '1.7' }, text: 'First' });
      expect(editor.state.doc.lastChild?.attrs).toMatchObject({ textAlign: 'justify', lineHeight: '2' });
      expect(editor.state.doc.childCount).toBe(2);
      expect(undoDepth(editor.state)).toBe(1);
      const after = editor.getJSON();
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getJSON()).toEqual(before);
      expect(editor.state.selection.toJSON()).toEqual(selection);
      expect(editor.commands.redo()).toBe(true);
      expect(editor.getJSON()).toEqual(after);
    });
  }

  it.each([
    ['text-align:left', { textAlign: 'left', lineHeight: '1.5' }],
    ['text-align:center', { textAlign: 'center', lineHeight: '1.5' }],
    ['line-height:2', { textAlign: 'right', lineHeight: '2' }],
  ])('transfers only the explicitly retained source property %s', (style, attrs) => {
    const editor = mount();
    paste(editor, `<p style="${style}">Source</p>`);
    expect(firstParagraph(editor)).toMatchObject({ attrs, text: 'Source' });
  });

  it('keeps a neutral Word section wrapper and ignores removed declarations', () => {
    const editor = mount();
    paste(editor, `<div class="WordSection1"><p style="${sourceStyle};position:fixed">Source</p></div>`);
    expect(firstParagraph(editor)).toMatchObject({ attrs: { textAlign: 'center', lineHeight: '1.7' }, text: 'Source' });
    expect(editor.state.doc.childCount).toBe(1);
  });

  it('preserves target attributes unrelated to alignment and spacing', () => {
    const identity = Extension.create({
      name: 'paragraphIdentity',
      addGlobalAttributes: () => [{ types: ['paragraph'], attributes: {
        identity: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute('data-identity') },
      } }],
    });
    const editor = mount(`<p data-identity="existing-block" style="${targetStyle}"></p>`, {}, [identity]);
    paste(editor, `<p data-identity="source-block" style="${sourceStyle}">Source</p>`);
    expect(firstParagraph(editor).attrs).toMatchObject({ identity: 'existing-block', textAlign: 'center', lineHeight: '1.7' });
  });

  it('preserves the existing UniqueID and reports one accepted operation with live references', async () => {
    const completed = vi.fn();
    const editor = mount(empty, { onPasteResult: completed }, [UniqueID]);
    await vi.waitFor(() => { expect(editor.state.doc.firstChild?.attrs['id']).toEqual(expect.any(String)); });
    const before = editor.getJSON();
    const id = editor.state.doc.firstChild?.attrs['id'];
    expect(id).toEqual(expect.any(String));
    paste(editor, source);
    await vi.waitFor(() => { expect(completed).toHaveBeenCalledOnce(); });
    expect(firstParagraph(editor).attrs).toMatchObject({ id, textAlign: 'center', lineHeight: '1.7' });
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied', references: { expired: false } });
    expect(undoDepth(editor.state)).toBe(1);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
  });

  it.each(['left', 'center'])('does not transfer %s source formatting onto an unstyled host prefix', alignment => {
    const host = Extension.create({ name: 'prefix', addProseMirrorPlugins: () => [new Plugin({ props: {
      transformPastedHTML: html => `<p>Host prefix</p>${html}`,
    } })] });
    const editor = mount(empty, {}, [host]);
    paste(editor, `<p style="text-align:${alignment};line-height:2">Source</p>`);
    expect(firstParagraph(editor)).toMatchObject({ attrs: { textAlign: 'right', lineHeight: '1.5' }, text: 'Host prefix' });
    expect(editor.state.doc.lastChild?.textContent).toBe('Source');
  });

  it('respects a later host transform that replaces the explicit source style', () => {
    const host = Extension.create({ name: 'replaceStyle', addProseMirrorPlugins: () => [new Plugin({ props: {
      transformPastedHTML: html => html.replaceAll('center', 'justify').replaceAll('1.7', '2'),
    } })] });
    const editor = mount(empty, {}, [host]);
    paste(editor, source);
    expect(firstParagraph(editor).attrs).toMatchObject({ textAlign: 'right', lineHeight: '1.5' });
  });

  it('allows a synchronous programmatic paste inside a native drop handler', () => {
    vi.stubGlobal('ClipboardEvent', Event);
    const host = Extension.create({ name: 'pasteInsideDrop', addProseMirrorPlugins: () => [new Plugin({ props: {
      handleDOMEvents: { drop: view => { view.pasteHTML(source); return true; } },
    } })] });
    const editor = mount(empty, {}, [host]);
    editor.view.dom.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    expect(firstParagraph(editor)).toMatchObject({ attrs: { textAlign: 'center', lineHeight: '1.7' }, text: 'First' });
  });

  it('leaves no formatting mutation when the root paste transaction is vetoed', async () => {
    const completed = vi.fn();
    const host = Extension.create({ name: 'vetoPaste', addProseMirrorPlugins: () => [new Plugin({
      filterTransaction: transaction => transaction.getMeta(pasteCleanupKey) === undefined,
    })] });
    const editor = mount(empty, { onPasteResult: completed }, [host]);
    const before = editor.getJSON();
    paste(editor, source);
    await vi.waitFor(() => { expect(completed).toHaveBeenCalledOnce(); });
    expect(editor.getJSON()).toEqual(before);
    expect(undoDepth(editor.state)).toBe(0);
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'untracked' });
  });

  it('keeps a vetoed appended format change out of the accepted paste and its history', async () => {
    const completed = vi.fn();
    let veto = true;
    const host = Extension.create({ name: 'vetoFormat', addProseMirrorPlugins: () => [new Plugin({
      filterTransaction: transaction => !veto || transaction.getMeta(pasteCleanupKey) !== undefined || !transaction.docChanged,
    })] });
    const editor = mount(empty, { onPasteResult: completed }, [host]);
    const before = editor.getJSON();
    paste(editor, source);
    await vi.waitFor(() => { expect(completed).toHaveBeenCalledOnce(); });
    expect(firstParagraph(editor)).toMatchObject({ attrs: { textAlign: 'right', lineHeight: '1.5' }, text: 'First' });
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied', references: { expired: false } });
    expect(undoDepth(editor.state)).toBe(1);
    veto = false;
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
  });

  it('does not overwrite an earlier host normalizer or patch a replacement paragraph', () => {
    for (const replace of [false, true]) {
      const host = Extension.create({ name: 'normalizePasteFirst', priority: 1500, addProseMirrorPlugins: () => [new Plugin({
        appendTransaction: (transactions, _before, state) => {
          if (!transactions.some(transaction => transaction.getMeta(pasteCleanupKey) !== undefined)) return null;
          if (replace) return state.tr.insertText('Host ', 1);
          return state.tr.setNodeMarkup(0, undefined, { ...state.doc.firstChild?.attrs, textAlign: 'justify', lineHeight: '2' });
        },
      })] });
      const editor = mount(empty, {}, [host]);
      paste(editor, source);
      expect(firstParagraph(editor)).toMatchObject(replace
        ? { attrs: { textAlign: 'right', lineHeight: '1.5' }, text: 'Host First' }
        : { attrs: { textAlign: 'justify', lineHeight: '2' }, text: 'First' });
      expect(undoDepth(editor.state)).toBe(1);
    }
  });

  it('ignores a custom handler that inserts other content or inserts the slice elsewhere', () => {
    for (const elsewhere of [false, true]) {
      const host = Extension.create({ name: 'customPaste', addProseMirrorPlugins: () => [new Plugin({ props: {
        handlePaste: (view, _event, slice) => {
          view.dispatch(elsewhere ? view.state.tr.insert(view.state.doc.content.size, slice.content) : view.state.tr.insertText('Host content'));
          return true;
        },
      } })] });
      const editor = mount(empty, {}, [host]);
      paste(editor, source);
      expect(firstParagraph(editor)).toMatchObject({ attrs: { textAlign: 'right', lineHeight: '1.5' }, text: elsewhere ? '' : 'Host content' });
    }
  });

  it.each(['native', 'programmatic'] as const)('retains first paragraph intent through an image-free %s preparation', route => {
    const editor = mount(empty, { imageAssets: { mode: 'embedded' } });
    paste(editor, source, route);
    expect(firstParagraph(editor)).toMatchObject({ attrs: { textAlign: 'center', lineHeight: '1.7' }, text: 'First' });
    expect(undoDepth(editor.state)).toBe(1);
  });

  it('supports pasteHTML without an explicit clipboard event', () => {
    vi.stubGlobal('ClipboardEvent', Event);
    const editor = mount();
    expect(editor.view.pasteHTML(source)).toBe(true);
    expect(firstParagraph(editor)).toMatchObject({ attrs: { textAlign: 'center', lineHeight: '1.7' }, text: 'First' });
  });

  it.each(['native', 'programmatic'] as const)('preserves the first paragraph through asynchronous %s image preparation and exact Undo', async route => {
    const completed = vi.fn();
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'), character => character.charCodeAt(0));
    const file = new File([bytes], 'diagram.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(bytes.buffer) });
    const editor = mount(empty, {
      imageAssets: { mode: 'embedded', match: context => context.references.map(reference => ({
        placementId: reference.placementId, itemIndex: 1, evidence: { kind: 'host', matcherId: 'first-paragraph-fixture' },
      })) },
      onPasteResult: completed,
    }, [Image.configure({ allowBase64: true })]);
    const before = editor.getJSON();
    const selection = editor.state.selection.toJSON();
    paste(editor, `<p style="${sourceStyle}">First</p><img src="cid:diagram" alt="Diagram"><p>After</p>`, route, [file]);
    await vi.waitFor(() => { expect(completed).toHaveBeenCalledOnce(); });
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied' });
    expect(firstParagraph(editor)).toMatchObject({ attrs: { textAlign: 'center', lineHeight: '1.7' }, text: 'First' });
    expect(editor.state.doc.child(1).type.name).toBe('image');
    expect(editor.state.doc.child(1).attrs['src']).toMatch(/^data:image\/png;base64,/u);
    expect(undoDepth(editor.state)).toBe(1);
    const after = editor.getJSON();
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
    expect(editor.state.selection.toJSON()).toEqual(selection);
    expect(editor.commands.redo()).toBe(true);
    expect(editor.getJSON()).toEqual(after);
  });

  it.each([false, true])('keeps SmartPaste whole-block image insertion identity semantics, explicit style=%s', async styled => {
    const completed = vi.fn();
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'), character => character.charCodeAt(0));
    const file = new File([bytes], 'diagram.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(bytes.buffer) });
    const editor = mount(`<p id="existing-target" style="${targetStyle}"></p>`, {
      imageAssets: { mode: 'embedded', match: context => context.references.map(reference => ({
        placementId: reference.placementId, itemIndex: 1, evidence: { kind: 'host', matcherId: 'first-paragraph-fixture' },
      })) }, onPasteResult: completed,
    }, [Image.configure({ allowBase64: true }), SmartPaste, UniqueID]);
    const before = editor.getJSON();
    paste(editor, `<p${styled ? ` style="${sourceStyle}"` : ''}>First</p><img src="cid:diagram" alt="Diagram"><p>After</p>`, 'native', [file]);
    await vi.waitFor(() => { expect(completed).toHaveBeenCalledOnce(); });
    const id = firstParagraph(editor).attrs['id'];
    expect(id).toEqual(expect.any(String));
    expect(id).not.toBe('existing-target');
    if (styled) expect(firstParagraph(editor).attrs).toMatchObject({ textAlign: 'center', lineHeight: '1.7' });
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
  });

  it.each([
    ['list label', `<ul><li>${empty}</li></ul>`, []],
    ['table cell', `<table><tbody><tr><td>${empty}</td></tr></tbody></table>`, [Table, TableRow, TableCell, TableHeader]],
  ] satisfies [string, string, AnyExtension[]][])('preserves the empty %s container and its paragraph formatting', (_name, content, extra) => {
    const editor = mount(content, {}, extra);
    const container = editor.state.doc.firstChild?.type.name;
    paste(editor, `<p style="${sourceStyle}">Source</p>`);
    expect(editor.state.doc.firstChild?.type.name).toBe(container);
    expect(firstParagraph(editor)).toMatchObject({ attrs: { textAlign: 'center', lineHeight: '1.7' }, text: 'Source' });
    expect(() => { editor.state.doc.check(); }).not.toThrow();
  });

  it.each([1, 3, 5])('keeps the destination style around existing text at position %i', position => {
    const editor = mount(`<p style="${targetStyle}">ABCD</p>`);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position)));
    paste(editor, source);
    expect(firstParagraph(editor).attrs).toMatchObject({ textAlign: 'right', lineHeight: '1.5' });
    expect(editor.state.doc.textContent).toBe(`${'ABCD'.slice(0, position - 1)}FirstSecond${'ABCD'.slice(position - 1)}`);
    expect(editor.state.doc.lastChild?.attrs).toMatchObject({ textAlign: 'justify', lineHeight: '2' });
  });

  it('does not treat a text selection, or a space, as an empty destination', () => {
    for (const text of ['ABCD', ' ']) {
      const editor = mount(text === ' ' ? empty : `<p style="${targetStyle}">${text}</p>`);
      if (text === ' ') editor.view.dispatch(editor.state.tr.insertText(' ', 1));
      else editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 5)));
      expect(editor.state.doc.textContent).toBe(text);
      paste(editor, `<p style="${sourceStyle}">Source</p>`);
      expect(firstParagraph(editor).attrs).toMatchObject({ textAlign: 'right', lineHeight: '1.5' });
    }
  });

  it('retains the destination format for unstyled HTML and plain text', () => {
    for (const plain of [false, true]) {
      const editor = mount();
      if (plain) editor.view.pasteText('Source', new Event('paste') as ClipboardEvent); else paste(editor, '<p>Source</p>');
      expect(firstParagraph(editor)).toMatchObject({ attrs: { textAlign: 'right', lineHeight: '1.5' }, text: 'Source' });
    }
  });

  it.each([false, true])('keeps Adapt insertion semantics, preserveTextAlignment=%s', preserveTextAlignment => {
    const editor = mount(empty, { formatting: 'adapt', preserveTextAlignment });
    paste(editor, `<p style="${sourceStyle}">Source</p>`);
    expect(firstParagraph(editor)).toMatchObject({ attrs: { textAlign: 'right', lineHeight: '1.5' }, text: 'Source' });
  });

  it('does not turn an empty heading into a source paragraph', () => {
    const editor = mount(`<h2 style="${targetStyle}"></h2>`);
    paste(editor, `<p style="${sourceStyle}">Source</p>`);
    expect(editor.state.doc.firstChild?.type.name).toBe('heading');
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ level: 2, textAlign: 'right', lineHeight: '1.5' });
    expect(editor.state.doc.textContent).toBe('Source');
  });

  it('keeps the existing source heading insertion behavior', () => {
    const editor = mount();
    paste(editor, `<h2 style="${sourceStyle}">Heading</h2>`);
    expect(editor.state.doc.firstChild?.type.name).toBe('heading');
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ level: 2, textAlign: 'center', lineHeight: '1.7' });
    expect(editor.state.doc.textContent).toBe('Heading');
  });

  it('leaves dropped HTML unchanged and does not retain that drop intent for a later paste', async () => {
    const editor = mount();
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: -1 });
    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperties(event, {
      dataTransfer: { value: { types: ['text/html'], files: [], items: [], getData: (type: string) => type === 'text/html' ? source : '', dropEffect: 'copy' } },
      clientX: { value: 1 }, clientY: { value: 1 },
    });
    editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(firstParagraph(editor).attrs).toMatchObject({ textAlign: 'right', lineHeight: '1.5' });
    editor.commands.setContent(empty);
    await Promise.resolve();
    paste(editor, source, 'programmatic');
    expect(firstParagraph(editor).attrs).toMatchObject({ textAlign: 'center', lineHeight: '1.7' });
  });

  it('preserves the current partial own-copy behavior', () => {
    const from = mount(`<p style="${sourceStyle}">Before Source after</p>`);
    from.view.dispatch(from.state.tr.setSelection(TextSelection.create(from.state.doc, 8, 14)));
    const html = from.view.serializeForClipboard(from.state.selection.content()).dom.innerHTML;
    expect(html).toContain('data-domternal-copy');
    expect(html).toContain('data-pm-slice="1 1');
    const to = mount();
    paste(to, html);
    expect(firstParagraph(to)).toMatchObject({ attrs: { textAlign: 'right', lineHeight: '1.5' }, text: 'Source' });
  });
});
