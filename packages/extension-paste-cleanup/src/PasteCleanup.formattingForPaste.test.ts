import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Bold, Document, Editor, Extension, FontFamily, FontSize, History, Paragraph, Text, TextColor, TextStyle } from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { Plugin } from '@domternal/pm/state';
import { registerClipboardHTMLPreparation } from '@domternal/core/clipboard';
import { Image } from '../../extension-image/dist/index.js';
import { PasteCleanup } from './PasteCleanup.js';
import type { PasteCleanupOptions } from './PasteCleanup.js';
import type { PasteFormatting } from './html/types.js';
import type { PasteFormattingResolver } from './pasteFormatting.js';

const source = '<p><strong><span style="color:#ff0000;font-family:Georgia;font-size:18px">Source</span></strong></p>';
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'), char => char.charCodeAt(0));
const editors: Editor[] = [];
beforeEach(() => { vi.stubGlobal('ClipboardEvent', class extends Event {}); });
afterEach(() => {
  for (const editor of editors.splice(0)) if (!editor.isDestroyed) editor.destroy();
  vi.unstubAllGlobals();
});

function mount(options: PasteCleanupOptions, extra: AnyExtension[] = []): {
  editor: Editor;
  normalized: Mock<NonNullable<PasteCleanupOptions['onResult']>>;
  completed: Mock<NonNullable<PasteCleanupOptions['onPasteResult']>>;
} {
  const normalized = vi.fn<NonNullable<PasteCleanupOptions['onResult']>>(result => { options.onResult?.(result); });
  const completed = vi.fn<NonNullable<PasteCleanupOptions['onPasteResult']>>(result => { options.onPasteResult?.(result); });
  const editor = new Editor({ content: '<p>Before</p>', extensions: [Document, Paragraph, Text, History, Bold,
    TextStyle, TextColor, FontFamily, FontSize, Image.configure({ allowBase64: true }),
    PasteCleanup.configure({ ...options, onResult: normalized, onPasteResult: completed }), ...extra,
  ] });
  editors.push(editor);
  editor.view.setProps({ handleScrollToSelection: () => true });
  editor.commands.selectAll();
  return { editor, normalized, completed };
}

function clipboard(html: string, files: readonly File[] = []): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    items: [{ kind: 'string', type: 'text/html', getAsFile: () => null }, ...files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file }))],
    files, getData: (type: string) => type === 'text/html' ? html : '',
  } });
  return event as ClipboardEvent;
}

function paste(editor: Editor, html: string, route: 'native' | 'programmatic' | 'without-event', files: readonly File[] = []): void {
  if (route === 'without-event') editor.view.pasteHTML(html);
  else if (route === 'programmatic') editor.view.pasteHTML(html, clipboard(html, files));
  else editor.view.dom.dispatchEvent(clipboard(html, files));
}

function checkSource(editor: Editor, formatting: PasteFormatting, text = 'Source'): void {
  const nodes: { text: string | undefined; bold: boolean; color: unknown; fontFamily: unknown; fontSize: unknown }[] = [];
  editor.state.doc.descendants(node => {
    if (!node.isText) return;
    const attrs = node.marks.find(mark => mark.type.name === 'textStyle')?.attrs;
    nodes.push({ text: node.text, bold: node.marks.some(mark => mark.type.name === 'bold'), color: attrs?.['color'],
      fontFamily: attrs?.['fontFamily'], fontSize: attrs?.['fontSize'] });
  });
  expect(nodes).toHaveLength(1);
  expect(nodes[0]).toMatchObject({ text, bold: true });
  if (formatting === 'preserve') expect(nodes[0]).toMatchObject({ color: '#ff0000', fontFamily: 'Georgia', fontSize: '18px' });
  else {
    expect(nodes[0]?.color ?? null).toBeNull();
    expect(nodes[0]?.fontFamily ?? null).toBeNull();
    expect(nodes[0]?.fontSize ?? null).toBeNull();
  }
}

describe('PasteCleanup formattingForPaste', () => {
  it('validates the policy before installing clipboard handlers', () => {
    expect(() => mount({ formattingForPaste: 'adapt' as unknown as PasteFormattingResolver })).toThrow('formattingForPaste must be a function');
  });

  it('claims a preparation slot only for an explicitly configured policy when image assets are disabled', () => {
    const plain = mount({ imageAssets: false });
    const dispose = registerClipboardHTMLPreparation(plain.editor.view, () => undefined);
    dispose();
    const configured = mount({ imageAssets: false, formattingForPaste: () => 'adapt' });
    expect(() => registerClipboardHTMLPreparation(configured.editor.view, () => undefined)).toThrow();
  });

  it('honors the existing preparation ownership error and releases partial setup', () => {
    const destroyed = vi.fn();
    const earlier = Extension.create({ name: 'earlierPreparation', priority: 2000,
      addProseMirrorPlugins: () => [new Plugin({ view(view) {
        const dispose = registerClipboardHTMLPreparation(view, () => undefined);
        return { destroy() { dispose(); destroyed(); } };
      } })],
    });
    expect(() => mount({ formattingForPaste: () => 'adapt' }, [earlier])).toThrow('HTML preparation');
    expect(destroyed).toHaveBeenCalledOnce();
  });

  for (const imageAssets of [false, { mode: 'embedded' }] as const) {
    for (const route of ['native', 'programmatic', 'without-event'] as const) {
      it.each(['preserve', 'adapt'] as const)(`chooses %s once for ${route}, imageAssets=${String(imageAssets !== false)}`, async formatting => {
        const choose = vi.fn<PasteFormattingResolver>(() => formatting);
        const { editor, normalized, completed } = mount({ formatting: formatting === 'preserve' ? 'adapt' : 'preserve', formattingForPaste: choose, imageAssets });
        const before = editor.getJSON();
        paste(editor, source, route);
        await vi.waitFor(() => { expect(completed).toHaveBeenCalledOnce(); });
        checkSource(editor, formatting);
        expect(choose).toHaveBeenCalledOnce();
        expect(choose.mock.calls[0]?.[0]).toEqual({ defaultFormatting: formatting === 'preserve' ? 'adapt' : 'preserve', origin: route === 'native' ? 'native' : 'programmatic' });
        expect(normalized).toHaveBeenCalledOnce();
        expect(normalized.mock.calls[0]?.[0].formatting).toBe(formatting);
        expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied', formatting });
        const after = editor.getJSON();
        expect(editor.commands.undo()).toBe(true);
        expect(editor.getJSON()).toEqual(before);
        expect(editor.commands.redo()).toBe(true);
        expect(editor.getJSON()).toEqual(after);
        expect(choose).toHaveBeenCalledOnce();
      });
    }
  }

  it.each(['native', 'programmatic'] as const)('retains an image preparation choice after the host changes it, route=%s', async route => {
    let selected: PasteFormatting = 'adapt';
    const choose = vi.fn(() => selected);
    let resolve!: (value: ArrayBuffer) => void;
    const pending = new Promise<ArrayBuffer>(accept => { resolve = accept; });
    const file = new File([png], 'chart.png', { type: 'image/png' });
    const read = vi.fn(() => pending);
    Object.defineProperty(file, 'arrayBuffer', { value: read });
    const { editor, completed, normalized } = mount({ formattingForPaste: choose, imageAssets: {
      mode: 'embedded', match: context => context.references.map(reference => ({ placementId: reference.placementId, itemIndex: 1,
        evidence: { kind: 'host' as const, matcherId: 'formatting-test' } })),
    } });
    paste(editor, source + '<p><img src="cid:chart" alt="Chart"></p>', route, [file]);
    await vi.waitFor(() => { expect(read).toHaveBeenCalledOnce(); });
    expect(editor.state.doc.textContent).toBe('Before');
    selected = 'preserve';
    resolve(png.buffer);
    await vi.waitFor(() => { expect(completed).toHaveBeenCalledOnce(); });
    checkSource(editor, 'adapt');
    expect(editor.view.dom.querySelector('img')?.getAttribute('alt')).toBe('Chart');
    expect(choose).toHaveBeenCalledOnce();
    expect(normalized.mock.calls[0]?.[0].formatting).toBe('adapt');
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied', formatting: 'adapt' });
    editor.commands.selectAll();
    paste(editor, source, route);
    await vi.waitFor(() => { expect(completed).toHaveBeenCalledTimes(2); });
    checkSource(editor, 'preserve');
    expect(choose).toHaveBeenCalledTimes(2);
  });

  it.each([false, { mode: 'embedded' }] as const)('does not leak a nested event-free policy into another attempt, imageAssets=%s', async imageAssets => {
    let count = 0;
    const choose = vi.fn(() => {
      if (++count === 1) { fixture.editor.view.pasteHTML(source.replace('Source', 'Inner')); return 'adapt' as const; }
      return 'preserve' as const;
    });
    const fixture = mount({ formattingForPaste: choose, imageAssets });
    const { editor } = fixture;
    editor.view.pasteHTML(source.replace('Source', 'Outer'));
    await vi.waitFor(() => { expect(fixture.completed).toHaveBeenCalledOnce(); });
    checkSource(editor, 'preserve', 'Inner');
    expect(choose).toHaveBeenCalledTimes(2);
    expect(fixture.completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied', formatting: 'preserve' });
  });

  it.each(['throw', 'invalid', 'async-reject'] as const)('keeps configured sanitization after a %s host policy failure', async kind => {
    const choose = (() => {
      if (kind === 'throw') throw new Error('Host failed');
      return kind === 'invalid' ? 'invalid' : Promise.reject(new Error('Async policies are unsupported'));
    }) as unknown as PasteFormattingResolver;
    const { editor, completed } = mount({ formatting: 'adapt', formattingForPaste: choose });
    paste(editor, source + '<script>unsafe()</script>', 'without-event');
    await vi.waitFor(() => { expect(completed).toHaveBeenCalledOnce(); });
    checkSource(editor, 'adapt');
    expect(editor.getHTML()).not.toContain('script');
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'applied', formatting: 'adapt' });
  });

  it('chooses once even when an earlier host HTML transform changes the input', async () => {
    const transform = vi.fn((html: string) => html.replace('Source', 'Host'));
    const earlier = Extension.create({ name: 'earlierFormattingHTML', priority: 2000,
      addProseMirrorPlugins: () => [new Plugin({ props: { transformPastedHTML: transform } })],
    });
    const choose = vi.fn(() => 'adapt' as const);
    const { editor, completed } = mount({ formattingForPaste: choose, imageAssets: { mode: 'embedded' } }, [earlier]);
    paste(editor, source, 'native');
    await vi.waitFor(() => { expect(completed).toHaveBeenCalledOnce(); });
    checkSource(editor, 'adapt', 'Host');
    expect(transform).toHaveBeenCalledOnce();
    expect(choose).toHaveBeenCalledOnce();
  });

  it('keeps a no-event nested observer paste distinct from its outer normalization', async () => {
    let choice: PasteFormatting = 'adapt';
    const choose = vi.fn(() => choice);
    const fixture = mount({ formattingForPaste: choose, onResult(result) {
      if (result.html.includes('Outer')) {
        choice = 'preserve';
        fixture.editor.view.pasteHTML(source.replace('Source', 'Inner'));
      }
    } });
    fixture.editor.view.pasteHTML(source.replace('Source', 'Outer'));
    await vi.waitFor(() => { expect(fixture.completed).toHaveBeenCalledTimes(2); });
    const runs: { text: string | undefined; color: unknown; bold: boolean }[] = [];
    fixture.editor.state.doc.descendants(node => {
      if (node.isText) runs.push({ text: node.text, color: node.marks.find(mark => mark.type.name === 'textStyle')?.attrs['color'] ?? null,
        bold: node.marks.some(mark => mark.type.name === 'bold') });
    });
    expect(runs).toEqual([{ text: 'Inner', color: '#ff0000', bold: true }, { text: 'Outer', color: null, bold: true }]);
    expect(fixture.normalized.mock.calls.map(([result]) => result.formatting)).toEqual(['adapt', 'preserve']);
    expect(fixture.completed.mock.calls.map(([result]) => [result.status, result.formatting])).toEqual([['applied', 'preserve'], ['applied', 'adapt']]);
    expect(choose).toHaveBeenCalledTimes(2);
  });

  for (const route of ['native', 'dispatch'] as const) {
    it.each([false, { mode: 'embedded' }] as const)(`uses the configured default for a nested ${route} drop, imageAssets=%s`, async imageAssets => {
      let insideDrop = '';
      const choose = vi.fn(() => {
        const event = new Event('drop', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: {
          items: [], files: [], types: ['text/html'], getData: (kind: string) => kind === 'text/html' ? source.replace('Source', 'Dropped') : '',
        } });
        if (route === 'native') fixture.editor.view.dom.dispatchEvent(event); else fixture.editor.view.dispatchEvent(event);
        insideDrop = fixture.editor.getHTML();
        return 'adapt' as const;
      });
      const fixture = mount({ formatting: 'preserve', formattingForPaste: choose, imageAssets });
      fixture.editor.view.posAtCoords = () => ({ pos: 1, inside: -1 });
      fixture.editor.view.pasteHTML(source.replace('Source', 'Outer'));
      await vi.waitFor(() => { expect(fixture.completed).toHaveBeenCalledTimes(2); });
      expect(insideDrop).toContain('Dropped');
      expect(insideDrop).toContain('color: #ff0000');
      expect(insideDrop).toContain('font-family: Georgia');
      expect(fixture.normalized.mock.calls.map(([result]) => result.formatting)).toEqual(['preserve', 'adapt']);
      expect(fixture.completed.mock.calls.map(([result]) => [result.status, result.formatting])).toEqual([['untracked', 'preserve'], ['applied', 'adapt']]);
      expect(choose).toHaveBeenCalledOnce();
      const outer = fixture.editor.getHTML();
      expect(outer).toContain('Outer');
      expect(outer).not.toContain('color:');
      expect(outer).not.toContain('font-family:');
    });
  }

  it('does not choose a paste policy for an unrelated HTML drop transform', () => {
    const choose = vi.fn(() => 'adapt' as const);
    const { editor } = mount({ formatting: 'preserve', formattingForPaste: choose });
    let transformed = source;
    editor.view.someProp('transformPastedHTML', transform => { transformed = transform(transformed, editor.view); return false; });
    expect(transformed).toContain('color:#ff0000');
    expect(choose).not.toHaveBeenCalled();
  });

  it('ends empty and plain-text policy attempts before a later HTML paste', async () => {
    let choice: PasteFormatting = 'adapt';
    const choose = vi.fn(() => choice);
    const { editor, completed } = mount({ formattingForPaste: choose });
    editor.view.pasteHTML('');
    expect(editor.state.doc.textContent).toBe('Before');
    editor.view.pasteText('Plain');
    await vi.waitFor(() => { expect(completed).toHaveBeenCalled(); });
    expect(completed.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'applied', source: 'plain-text', formatting: 'adapt' });
    choice = 'preserve';
    editor.commands.selectAll();
    editor.view.pasteHTML(source);
    checkSource(editor, 'preserve');
    expect(choose).toHaveBeenCalledTimes(3);
  });

  it('allows destruction from the host policy without continuing a stale paste', () => {
    const fixture = mount({ formattingForPaste() { fixture.editor.destroy(); return 'adapt'; } });
    expect(() => fixture.editor.view.pasteHTML(source)).not.toThrow();
    expect(fixture.editor.isDestroyed).toBe(true);
    expect(fixture.normalized).not.toHaveBeenCalled();
    expect(fixture.completed).not.toHaveBeenCalled();
  });

  it('keeps the cancelled asset operation policy while the next attempt selects another', async () => {
    let selected: PasteFormatting = 'adapt';
    let cancel: (() => void) | undefined;
    let resolve!: (value: ArrayBuffer) => void;
    const pending = new Promise<ArrayBuffer>(accept => { resolve = accept; });
    const file = new File([png], 'chart.png', { type: 'image/png' });
    const read = vi.fn(() => pending);
    Object.defineProperty(file, 'arrayBuffer', { value: read });
    const { editor, completed } = mount({ formattingForPaste: () => selected, onPasteProgress(progress) { cancel = progress.cancel; }, imageAssets: {
      mode: 'embedded', match: context => context.references.map(reference => ({ placementId: reference.placementId, itemIndex: 1,
        evidence: { kind: 'host' as const, matcherId: 'formatting-cancel-test' } })),
    } });
    paste(editor, source + '<p><img src="cid:chart"></p>', 'native', [file]);
    await vi.waitFor(() => { expect(read).toHaveBeenCalledOnce(); });
    cancel?.();
    await vi.waitFor(() => { expect(completed).toHaveBeenCalledOnce(); });
    expect(completed.mock.calls[0]?.[0]).toMatchObject({ status: 'rejected', reason: 'cancelled', formatting: 'adapt' });
    selected = 'preserve';
    paste(editor, source, 'native');
    resolve(png.buffer);
    await vi.waitFor(() => { expect(completed).toHaveBeenCalledTimes(2); });
    checkSource(editor, 'preserve');
    expect(editor.view.dom.querySelector('img')).toBeNull();
    expect(completed.mock.calls[1]?.[0]).toMatchObject({ status: 'applied', formatting: 'preserve' });
  });
});
