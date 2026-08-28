import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bold, Document, Editor, Extension, ExtensionConfigurationError, History, Link, Paragraph, Text } from '@domternal/core';
import type { EditorOptions } from '@domternal/core';
import { Plugin } from '@domternal/pm/state';
import { undoDepth } from '@domternal/pm/history';
import { PasteCleanup } from './PasteCleanup.js';
import type { PasteCleanupOptions } from './PasteCleanup.js';
import { getPasteAffectedReferences } from './operations.js';
import type { PasteOperationResult } from './operations.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) editor.destroy(); editors.length = 0; });
const settle = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

function clipboard(html = '', text = ''): ClipboardEvent {
  const event = new Event('paste', { cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    items: [], files: [], getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? text : '',
  } });
  return event as ClipboardEvent;
}

function pasteHTML(editor: Editor, html: string): boolean { return editor.view.pasteHTML(html, clipboard(html)); }
function pasteText(editor: Editor, text: string): boolean { return editor.view.pasteText(text, clipboard('', text)); }

function mount(options: PasteCleanupOptions = {}, additional: NonNullable<EditorOptions['extensions']> = [], events: Partial<EditorOptions> = {}): Editor {
  const editor = new Editor({
    ...events, content: '<p>Original</p>',
    extensions: [Document, Paragraph, Text, Bold, History,
      Link.configure({ autolink: false, linkOnPaste: true }), PasteCleanup.configure(options), ...additional],
  });
  editors.push(editor);
  editor.commands.selectAll();
  return editor;
}

function handler(name: string, priority: number, props: NonNullable<ConstructorParameters<typeof Plugin>[0]['props']>): Extension {
  return Extension.create({ name, priority, addProseMirrorPlugins: () => [new Plugin({ props })] });
}

describe('PasteCleanup accepted operation results', () => {
  it.each(['<script>alert(1)</script>', '<img src="file:///missing.png">', '<svg><path d="M0 0"></path></svg>'])(
    'preserves the selection and history when cleanup removes the entire source: %s', async html => {
      const completed = vi.fn();
      const editor = mount({ onPasteResult: completed });
      const selection = editor.state.selection.toJSON();
      pasteHTML(editor, html);
      await settle();
      expect(editor.state.doc.textContent).toBe('Original');
      expect(editor.state.selection.toJSON()).toEqual(selection);
      expect(undoDepth(editor.state)).toBe(0);
      expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'noop',
        references: expect.objectContaining({ ranges: [], expired: true }) }));
      expect(editor.view.dom.nextElementSibling?.textContent).toContain('Paste made no changes.');
    },
  );

  it('shows the default image warning without moving focus or entering document content', async () => {
    const editor = mount();
    editor.view.focus();
    const focused = document.activeElement;
    pasteHTML(editor, '<p>New<img src="file:///missing.png" alt=" diagram"></p>');
    await settle();
    const notice = editor.view.dom.nextElementSibling as HTMLElement;
    expect(notice.matches('.dm-paste-feedback')).toBe(true);
    expect(notice.hidden).toBe(false);
    expect(notice.querySelector('[role="status"]')?.textContent).toBe('Review the pasted content.');
    expect(document.activeElement).toBe(focused);
    expect(editor.state.doc.textContent).toBe('New diagram');
    expect(undoDepth(editor.state)).toBe(1);
    editor.destroy();
    expect(notice.parentNode).toBeNull();
  });

  it('keeps the default notice hidden for intentional adaptation alone', async () => {
    const editor = mount({ formatting: 'adapt' });
    pasteHTML(editor, '<p style="color:red">New</p>');
    await settle();
    expect((editor.view.dom.nextElementSibling as HTMLElement).hidden).toBe(true);
  });

  it('lets an application own feedback without installing the default UI', async () => {
    const completed = vi.fn();
    const editor = mount({ feedback: 'application', onPasteResult: completed });
    pasteHTML(editor, '<p>New<img src="file:///missing.png"></p>');
    await settle();
    expect(editor.view.dom.parentNode?.querySelector('.dm-paste-feedback')).toBeNull();
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'applied' }));
  });

  it.each([
    { feedback: 'application' as const },
    { feedback: 'unknown' as 'default' },
    { limits: { maxInputLength: 0 } },
  ])('fails editor setup for invalid options instead of silently disabling cleanup', options => {
    expect(() => mount(options)).toThrow(ExtensionConfigurationError);
  });

  it('separates synchronous normalization from a frozen accepted result and live operation references', async () => {
    const normalized = vi.fn();
    const completed = vi.fn();
    const editor = mount({ formatting: 'adapt', onResult: normalized, onPasteResult: completed });

    pasteHTML(editor, '<p style="color:red"><strong>New</strong></p>');

    expect(normalized).toHaveBeenCalledOnce();
    expect(completed).not.toHaveBeenCalled();
    await settle();
    expect(completed).toHaveBeenCalledOnce();
    const result = completed.mock.calls[0]?.[0] as PasteOperationResult;
    expect(result).toMatchObject({ operationId: normalized.mock.calls[0]?.[0].operationId,
      source: 'html', formatting: 'adapt', status: 'applied',
      references: { precision: 'operation', documentRevision: 1, expired: false } });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'formatting-adapted' }));
    expect(result).not.toHaveProperty('html');
    expect(result.references.ranges.length).toBeGreaterThan(0);
    expect(getPasteAffectedReferences(editor.view, result.operationId)).toEqual(result.references);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
    expect(Object.isFrozen(result.diagnostics[0])).toBe(true);
    expect(Object.isFrozen(result.references)).toBe(true);
    expect(Object.isFrozen(result.references.ranges)).toBe(true);
    expect(undoDepth(editor.state)).toBe(1);
  });

  it('reports normalization rejection without claiming an accepted transaction', async () => {
    const completed = vi.fn();
    const editor = mount({ limits: { maxDepth: 2 }, onPasteResult: completed });
    pasteHTML(editor, '<div><div><div>Rejected</div></div></div>');
    await settle();
    expect(editor.state.doc.textContent).toBe('Original');
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'rejected',
      references: expect.objectContaining({ expired: true, ranges: [] }) }));
    expect(undoDepth(editor.state)).toBe(0);
  });

  it('does not turn a filtered paste into an applied result or editor update', async () => {
    const completed = vi.fn();
    const updated = vi.fn();
    const filter = Extension.create({ name: 'rejectPastes', addProseMirrorPlugins: () => [new Plugin({
      filterTransaction: transaction => transaction.getMeta('paste') !== true,
    })] });
    const editor = mount({ onPasteResult: completed }, [filter], { onUpdate: updated });
    pasteHTML(editor, '<p>New</p>');
    await settle();
    expect(editor.state.doc.textContent).toBe('Original');
    expect(updated).not.toHaveBeenCalled();
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'untracked' }));
    expect(undoDepth(editor.state)).toBe(0);
  });

  it('keeps applied status when a host transaction callback throws after commit', async () => {
    const completed = vi.fn();
    const editor = mount({ onPasteResult: completed }, [], { onTransaction: ({ transaction }) => {
      if (transaction.docChanged) throw new Error('Host failure after commit');
    } });
    expect(() => pasteHTML(editor, '<p>New</p>')).toThrow('Host failure after commit');
    expect(editor.state.doc.textContent).toBe('New');
    await settle();
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'applied' }));
  });

  it('reads the final accepted append-normalized document revision', async () => {
    const completed = vi.fn();
    const normalize = Extension.create({ name: 'appendPasteSuffix', addProseMirrorPlugins: () => [new Plugin({
      appendTransaction(transactions, _previous, state) {
        return transactions.some(transaction => transaction.getMeta('paste') === true)
          ? state.tr.insertText('!', state.doc.content.size - 1) : null;
      },
    })] });
    const editor = mount({ onPasteResult: completed }, [normalize]);
    pasteHTML(editor, '<p>New</p>');
    await settle();
    expect(editor.state.doc.textContent).toBe('New!');
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'applied',
      references: expect.objectContaining({ documentRevision: 2, expired: false }) }));
  });

  it('reports untracked when an earlier handler consumes normalized content before receipt arming', async () => {
    const completed = vi.fn();
    const consume = handler('consumeFirst', 1300, { handlePaste: view => {
      view.dispatch(view.state.tr.insertText('Custom').setMeta('paste', true));
      return true;
    } });
    const editor = mount({ onPasteResult: completed }, [consume]);
    pasteHTML(editor, '<p>New</p>');
    await settle();
    expect(editor.state.doc.textContent).toBe('Custom');
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'untracked' }));
  });

  it('does not relabel a consumed paste after an empty same-task attempt skips transforms', async () => {
    const completed = vi.fn();
    let first = true;
    const consume = handler('consumeOnlyFirst', 1300, { handlePaste: view => {
      if (!first) return false;
      first = false;
      view.dispatch(view.state.tr.insertText('Custom'));
      return true;
    } });
    const editor = mount({ onPasteResult: completed }, [consume]);
    pasteHTML(editor, '<p>New</p>');
    pasteHTML(editor, '');
    await settle();
    expect(editor.state.doc.textContent).toBe('Custom');
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'untracked' }));
  });

  it('does not treat speculative state.apply or an unmarked custom dispatch as a receipt', async () => {
    const completed = vi.fn();
    const custom = handler('speculateWithoutPasteCommit', 1100, { handlePaste: view => {
      const hypothetical = view.state.apply(view.state.tr.insertText('Speculative').setMeta('paste', true));
      expect(hypothetical.doc.textContent).toBe('Speculative');
      view.dispatch(view.state.tr.insertText('Custom'));
      return true;
    } });
    const editor = mount({ onPasteResult: completed }, [custom]);
    pasteHTML(editor, '<p>New</p>');
    await settle();
    expect(editor.state.doc.textContent).toBe('Custom');
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'untracked' }));
  });

  it('retains immutable diagnostics when the normalization observer mutates its result', async () => {
    const completed = vi.fn();
    const editor = mount({ onPasteResult: completed, onResult: result => {
      result.status = 'rejected'; result.html = '<script>bad</script>'; result.diagnostics.length = 0;
    } });
    pasteHTML(editor, '<p>New<img src="https://example.invalid/image" alt=" diagram"></p>');
    await settle();
    expect(editor.state.doc.textContent).toBe('New diagram');
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied', diagnostics: [expect.objectContaining({ code: 'image-removed' })] });
  });

  it('keeps nested normalization operations distinct when one is rejected', async () => {
    const results: PasteOperationResult[] = [];
    let nested = false;
    const editor = mount({ limits: { maxDepth: 6 }, onPasteResult: result => { results.push(result); }, onResult: () => {
      if (nested) return;
      nested = true;
      pasteHTML(editor, '<div>'.repeat(10) + 'Rejected' + '</div>'.repeat(10));
    } });
    pasteHTML(editor, '<p>New</p>');
    await settle();
    expect(editor.state.doc.textContent).toBe('New');
    expect(results.map(result => result.status)).toEqual(['rejected', 'applied']);
    expect(new Set(results.map(result => result.operationId)).size).toBe(2);
  });

  it('completes each operation once when its completion observer pastes again or throws', async () => {
    const results: PasteOperationResult[] = [];
    const editor = mount({ onPasteResult: result => {
      results.push(result);
      if (results.length === 1) pasteHTML(editor, '<p>Next</p>');
      throw new Error('Observer failed');
    } });
    pasteHTML(editor, '<p>New</p>');
    await settle();
    expect(results).toHaveLength(2);
    expect(results.every(result => result.status === 'applied')).toBe(true);
    expect(new Set(results.map(result => result.operationId)).size).toBe(2);
  });

  it('tracks plain text and link-on-selection paste without reporting HTML normalization', async () => {
    const normalized = vi.fn();
    const completed = vi.fn();
    const editor = mount({ onResult: normalized, onPasteResult: completed });
    pasteText(editor, 'https://example.test/read');
    await settle();
    expect(editor.state.doc.textContent).toBe('Original');
    expect(editor.state.doc.firstChild?.firstChild?.marks.some(mark => mark.type.name === 'link')).toBe(true);
    expect(normalized).not.toHaveBeenCalled();
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ source: 'plain-text', status: 'applied',
      references: expect.objectContaining({ ranges: [{ from: 1, to: 9 }], expired: false }) }));
  });

  it('expires references after an unrelated interior edit while retaining the accepted outcome', async () => {
    const completed = vi.fn();
    const editor = mount({ onPasteResult: completed });
    pasteHTML(editor, '<p>New</p>');
    editor.view.dispatch(editor.state.tr.insertText('X', 2));
    await settle();
    expect(editor.state.doc.textContent).toBe('NXew');
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'applied',
      references: expect.objectContaining({ expired: true, ranges: [] }) }));
  });

  it('retains evidence of acceptance after a host callback destroys the editor, with expired references', async () => {
    const completed = vi.fn();
    const editor = mount({ onPasteResult: completed }, [], { onUpdate: () => { editor.destroy(); } });
    pasteHTML(editor, '<p>New</p>');
    await settle();
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'applied',
      references: expect.objectContaining({ expired: true, ranges: [] }) }));
    expect(getPasteAffectedReferences(editor.view, completed.mock.calls[0]?.[0].operationId)).toBeUndefined();
  });

  it('retains installed acceptance when an earlier plugin view destroys the editor before observation', async () => {
    const completed = vi.fn();
    const earlier = Extension.create({ name: 'destroyBeforeReceiptObserver', priority: 1300,
      addProseMirrorPlugins: () => [new Plugin({ view: () => ({ update(view, previous) {
        if (view.state.doc.eq(previous.doc)) return;
        owner.destroy();
        throw new Error('Destroyed after accepted change');
      } }) })],
    });
    const owner = mount({ onPasteResult: completed }, [earlier]);
    expect(() => pasteHTML(owner, '<p>New</p>')).toThrow('Destroyed after accepted change');
    await settle();
    expect(owner.view.state.doc.textContent).toBe('New');
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'applied',
      references: expect.objectContaining({ expired: true, ranges: [] }) }));
    expect(getPasteAffectedReferences(owner.view, completed.mock.calls[0]?.[0].operationId)).toBeUndefined();
  });

  it('retains installed acceptance when an earlier plugin view throws before observation', async () => {
    const completed = vi.fn();
    const earlier = Extension.create({ name: 'throwBeforeReceiptObserver', priority: 1300,
      addProseMirrorPlugins: () => [new Plugin({ view: () => ({ update(view, previous) {
        if (!view.state.doc.eq(previous.doc)) throw new Error('Plugin view failed after commit');
      } }) })],
    });
    const editor = mount({ onPasteResult: completed }, [earlier]);
    expect(() => pasteHTML(editor, '<p>New</p>')).toThrow('Plugin view failed after commit');
    await settle();
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'applied' }));
  });

  it('retains accepted outcomes when same-task pastes age out their references', async () => {
    const completed = vi.fn();
    const editor = mount({ onPasteResult: completed });
    for (let index = 0; index < 20; index++) pasteHTML(editor, `<p>Item ${String(index)}</p>`);
    await settle();
    expect(completed).toHaveBeenCalledTimes(20);
    expect(completed.mock.calls.every(([result]) => (result as PasteOperationResult).status === 'applied')).toBe(true);
    expect((completed.mock.calls[0]?.[0] as PasteOperationResult).references.expired).toBe(true);
  });

  it.each(['<p>Nested source</p>', ''])('does not attribute a nested earlier-handler transaction to the consumed outer paste: %s', async nestedHTML => {
    const completed = vi.fn();
    const normalized = vi.fn();
    let nestedEvent: ClipboardEvent | undefined;
    let nested = false;
    const earlier = handler('consumeNestedFirst', 1300, { handlePaste(view, event) {
      if (event !== nestedEvent) return false;
      view.dispatch(view.state.tr.insertText('Nested handled').setMeta('paste', true).setMeta('uiEvent', 'paste'));
      return true;
    } });
    const lower = handler('consumeOuterAndNest', 1100, { handlePaste() {
      if (nested) return false;
      nested = true;
      nestedEvent = clipboard(nestedHTML);
      owner.view.pasteHTML(nestedHTML, nestedEvent);
      return true;
    } });
    const owner = mount({ onResult: normalized, onPasteResult: completed }, [earlier, lower]);
    pasteHTML(owner, '<p>Outer source</p>');
    await settle();
    expect(owner.state.doc.textContent).toBe('Nested handled');
    expect(completed).toHaveBeenCalledTimes(nestedHTML === '' ? 1 : 2);
    expect(completed.mock.calls.every(([result]) => (result as PasteOperationResult).status === 'untracked')).toBe(true);
    const first = completed.mock.calls[0]?.[0] as PasteOperationResult;
    expect(first.operationId).toBe(normalized.mock.calls[0]?.[0].operationId);
    expect(first.references).toMatchObject({ expired: true, ranges: [] });
  });
});
