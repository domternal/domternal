import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bold, Document, Editor, Extension, History, Paragraph, Text, TextColor, TextStyle, UniqueID } from '@domternal/core';
import type { EditorOptions } from '@domternal/core';
import { Fragment, Slice } from '@domternal/pm/model';
import { Plugin } from '@domternal/pm/state';
import type { EditorState, Transaction } from '@domternal/pm/state';
import { undoDepth } from '@domternal/pm/history';
import { Image } from '../../extension-image/dist/index.js';
import { SmartPaste } from '../../extension-block-controls/dist/index.js';
import { PasteCleanup } from './PasteCleanup.js';
import type { PasteCleanupOptions } from './PasteCleanup.js';
import type { PasteOperationResult } from './operations.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) if (!editor.isDestroyed) editor.destroy(); editors.length = 0; });
const loss = { code: 'destination-formatting-removed', severity: 'warning' };
const source = '<p><strong>Private source</strong> retained text</p>';

function normalizer(name: string, change: (state: EditorState) => Transaction | null, priority = 100): Extension {
  return Extension.create({ name, priority, addProseMirrorPlugins: () => [new Plugin({
    appendTransaction: (transactions, _before, state) => transactions.some(transaction => transaction.getMeta('paste') === true)
      ? change(state) : null,
  })] });
}
function removeBold(state: EditorState): Transaction {
  return state.tr.removeMark(0, state.doc.content.size, state.schema.marks['bold']).setMeta('removedFormat', true);
}
function mount(additional: NonNullable<EditorOptions['extensions']> = [], options: PasteCleanupOptions = {}, events: Partial<EditorOptions> = {}): {
  editor: Editor; normalized: ReturnType<typeof vi.fn<NonNullable<PasteCleanupOptions['onResult']>>>;
  completed: ReturnType<typeof vi.fn<(result: PasteOperationResult) => void>>;
} {
  const normalized = vi.fn<NonNullable<PasteCleanupOptions['onResult']>>();
  const completed = vi.fn<(result: PasteOperationResult) => void>();
  const editor = new Editor({ ...events, content: '<p>Original</p>',
    extensions: [Document, Paragraph, Text, Bold, TextStyle, TextColor, History, PasteCleanup.configure({
      ...options, onResult: normalized, onPasteResult: completed,
    }), ...additional],
  });
  editors.push(editor);
  editor.view.setProps({ handleScrollToSelection: () => true });
  editor.commands.selectAll();
  return { editor, normalized, completed };
}
function paste(editor: Editor, html = source, native = false): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    items: [], files: [], getData: (kind: string) => kind === 'text/html' ? html : '',
  } });
  if (native) editor.view.dom.dispatchEvent(event);
  else editor.view.pasteHTML(html, event as ClipboardEvent);
}
async function settle(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

describe('accepted paste formatting evidence', () => {
  it.each([
    [false, false], [true, false], [false, true], [true, true],
  ])('reports accepted appended loss once, native=%s, image preparation=%s', async (native, assets) => {
    const { editor, normalized, completed } = mount([normalizer('removeBold', removeBold)], assets ? { imageAssets: { mode: 'embedded' } } : {});
    const before = editor.getJSON();
    const selection = editor.state.selection.toJSON();
    paste(editor, source, native);
    await settle();
    expect(normalized).toHaveBeenCalledOnce();
    expect(normalized.mock.calls[0]?.[0].diagnostics).toEqual([]);
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'applied', diagnostics: [loss], diagnosticsTruncated: false }));
    expect(JSON.stringify(completed.mock.calls[0]?.[0])).not.toContain('Private source');
    expect(editor.state.doc.textContent).toBe('Private source retained text');
    expect(editor.view.dom.querySelector('strong')).toBeNull();
    expect(editor.view.dom.nextElementSibling?.textContent).toContain('removed during this editor');
    expect(undoDepth(editor.state)).toBe(1);
    const after = editor.getJSON();
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
    expect(editor.state.selection.toJSON()).toEqual(selection);
    expect(editor.commands.redo()).toBe(true);
    expect(editor.getJSON()).toEqual(after);
    expect(completed).toHaveBeenCalledOnce();
  });

  it('does not report formatting restored by another accepted appended normalizer', async () => {
    const restore = normalizer('restoreBold', state => state.tr.addMark(1, 15, state.schema.mark('bold')), 90);
    const { editor, completed } = mount([normalizer('removeBold', removeBold), restore]);
    paste(editor);
    await settle();
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied', diagnostics: [] });
    expect(editor.view.dom.querySelector('strong')?.textContent).toBe('Private source');
  });

  it('reports accepted loss after asynchronous embedded-image replay with one Undo entry', async () => {
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
    const { editor, normalized, completed } = mount([Image.configure({ allowBase64: true }), normalizer('removeBold', removeBold)], {
      imageAssets: { mode: 'embedded' },
    });
    const before = editor.getJSON();
    paste(editor, `${source}<p><img src="${image}" alt="Chart"></p>`, true);
    expect(completed).not.toHaveBeenCalled();
    await vi.waitFor(() => { expect(completed).toHaveBeenCalledOnce(); }, { interval: 1 });
    expect(normalized).toHaveBeenCalledOnce();
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied', diagnostics: [loss] });
    expect(editor.view.dom.querySelector('strong')).toBeNull();
    expect(editor.view.dom.querySelector('img')?.getAttribute('src')).toBe(image);
    expect(editor.view.dom.querySelector('img')?.getAttribute('alt')).toBe('Chart');
    expect(undoDepth(editor.state)).toBe(1);
    const after = editor.getJSON();
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
    expect(editor.commands.redo()).toBe(true);
    expect(editor.getJSON()).toEqual(after);
  });

  it('retains the formatting witness through default SmartPaste placement and UniqueID bookkeeping', async () => {
    const { editor, completed } = mount([SmartPaste, UniqueID, normalizer('removeBold', removeBold)]);
    await vi.waitFor(() => { expect(typeof editor.state.doc.firstChild?.attrs['id']).toBe('string'); }, { interval: 1 });
    const before = editor.getJSON();
    paste(editor, '<p><strong>First</strong></p><p><strong>Second</strong></p>', true);
    await settle();
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied', diagnostics: [loss] });
    expect(editor.view.dom.querySelectorAll('strong')).toHaveLength(0);
    const ids: unknown[] = [];
    editor.state.doc.forEach(node => { ids.push(node.attrs['id']); });
    expect(ids).toHaveLength(2);
    expect(ids.every(id => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(2);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
  });

  it.each(['root', 'append'] as const)('does not report a vetoed %s transaction as an applied loss', async target => {
    const veto = Extension.create({ name: 'veto', addProseMirrorPlugins: () => [new Plugin({
      filterTransaction: transaction => target === 'root' ? transaction.getMeta('paste') !== true : transaction.getMeta('removedFormat') !== true,
    })] });
    const { editor, completed } = mount([normalizer('removeBold', removeBold), veto]);
    paste(editor);
    await settle();
    expect(completed).toHaveBeenCalledOnce();
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: target === 'root' ? 'untracked' : 'applied', diagnostics: [] });
    expect(editor.state.doc.textContent).toBe(target === 'root' ? 'Original' : 'Private source retained text');
    expect(undoDepth(editor.state)).toBe(target === 'root' ? 0 : 1);
  });

  it.each(['remove', 'undo', 'destroy'] as const)('does not mistake a reentrant independent %s for a paste normalizer', async action => {
    let changed = false;
    const { editor, completed } = mount([], {}, { onTransaction: ({ editor, transaction }) => {
      if (changed || transaction.getMeta('paste') !== true) return;
      if (!(editor instanceof Editor)) throw new Error('The fixture must use the Core Editor');
      changed = true;
      if (action === 'remove') editor.view.dispatch(removeBold(editor.state));
      else if (action === 'undo') editor.commands.undo();
      else editor.destroy();
    } });
    paste(editor);
    await settle();
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied', diagnostics: [] });
  });

  it('retains the accepted loss when a later independent callback restores the mark', async () => {
    let changed = false;
    const { editor, completed } = mount([normalizer('removeBold', removeBold)], {}, { onTransaction: ({ editor, transaction }) => {
      if (changed || transaction.getMeta('paste') !== true) return;
      if (!(editor instanceof Editor)) throw new Error('The fixture must use the Core Editor');
      changed = true;
      editor.view.dispatch(editor.state.tr.addMark(1, 15, editor.schema.mark('bold')));
    } });
    paste(editor);
    await settle();
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied', diagnostics: [loss] });
    expect(editor.view.dom.querySelector('strong')?.textContent).toBe('Private source');
  });

  it('retains accepted loss when the editor is destroyed during its transaction callback', async () => {
    const { editor, completed } = mount([normalizer('removeBold', removeBold)], {}, { onTransaction: ({ editor, transaction }) => {
      if (!(editor instanceof Editor)) throw new Error('The fixture must use the Core Editor');
      if (transaction.getMeta('paste') === true) editor.destroy();
    } });
    paste(editor);
    await settle();
    expect(completed).toHaveBeenCalledOnce();
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied', diagnostics: [loss], references: { expired: true } });
  });

  it('does not infer a loss from an equal-text replacement during appended processing', async () => {
    const replace = normalizer('replaceText', state => state.tr.replaceWith(1, 15, state.schema.text('Private source')));
    const { editor, completed } = mount([replace]);
    paste(editor);
    await settle();
    expect(editor.view.dom.querySelector('strong')).toBeNull();
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied', diagnostics: [] });
  });

  it('does not claim a custom handler inserted the recorded slice because its new content looks equal', async () => {
    const handler = Extension.create({ name: 'customHandler', priority: 100, addProseMirrorPlugins: () => [new Plugin({ props: {
      handlePaste(view) {
        const text = view.state.schema.text('Private source', [view.state.schema.mark('bold')]);
        const paragraph = view.state.schema.node('paragraph', null, [text, view.state.schema.text(' retained text')]);
        view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(paragraph), 1, 1)).setMeta('paste', true));
        return true;
      },
    } })] });
    const { editor, completed } = mount([handler, normalizer('removeBold', removeBold)]);
    paste(editor);
    await settle();
    expect(editor.view.dom.querySelector('strong')).toBeNull();
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied', diagnostics: [] });
  });

  it('does not let equal styled host-prefix text conceal loss on the original source', async () => {
    const change = normalizer('prefixAndRemove', state => state.tr.insertText('Private source ', 1).removeMark(16, 30, state.schema.marks['bold']));
    const { editor, completed } = mount([change]);
    paste(editor);
    await settle();
    expect(editor.view.dom.querySelector('strong')?.textContent).toBe('Private source ');
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied', diagnostics: [loss] });
  });

  it('checks separate equal-text nodes by insertion identity, not combined text or mark counts', async () => {
    const change = normalizer('moveBoldToEqualText', state => state.tr.removeMark(1, 5, state.schema.marks['bold'])
      .addMark(6, 10, state.schema.mark('bold')));
    const { editor, completed } = mount([change]);
    paste(editor, '<p><strong>Same</strong> Same</p>');
    await settle();
    expect(editor.state.doc.textContent).toBe('Same Same');
    expect(editor.view.dom.innerHTML).toContain('Same <strong>Same</strong>');
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied', diagnostics: [loss] });
  });

  it('keeps intentional adaptation outside the witness and respects the shared diagnostic limit', async () => {
    const { editor, normalized, completed } = mount([normalizer('removeBold', removeBold)], { formatting: 'adapt', limits: { maxDiagnostics: 1 } });
    paste(editor, '<p><strong><span style="color:red">Source</span></strong></p>');
    await settle();
    expect(normalized.mock.calls[0]?.[0].diagnostics).toEqual([{ code: 'formatting-adapted', severity: 'info', offset: expect.any(Number) }]);
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied', diagnostics: [loss], diagnosticsTruncated: true });
  });

  it('does not turn source-to-parser loss or an earlier host transform into an appended-loss claim', async () => {
    const transform = Extension.create({ name: 'removeBeforeParse', addProseMirrorPlugins: () => [new Plugin({ props: {
      transformPastedHTML: html => html.replaceAll('<strong>', '').replaceAll('</strong>', ''),
    } })] });
    const { editor, completed } = mount([transform]);
    paste(editor);
    await settle();
    expect(editor.view.dom.querySelector('strong')).toBeNull();
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied', diagnostics: [] });
  });
});
