import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  Bold, BulletList, Document, Editor, Extension, FontFamily, FontSize, Heading, History, ListItem, OrderedList,
  Paragraph, Text, TextAlign, TextColor, TextStyle,
} from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { Plugin } from '@domternal/pm/state';
import { undoDepth } from '@domternal/pm/history';
import { toHtml } from 'hast-util-to-html';
import type * as HTMLSerializationModule from 'hast-util-to-html';
import { SmartPaste } from '../../extension-block-controls/dist/index.js';
import { Markdown } from '../../extension-markdown/dist/index.js';
import { Image } from '../../extension-image/dist/index.js';
import { PasteCleanup } from './PasteCleanup.js';
import type { PasteCleanupOptions } from './PasteCleanup.js';
import { normalizeClipboardHTML } from './html/normalize.js';
import type * as NormalizationModule from './html/normalize.js';
import type { ClipboardResolverAdapter } from './clipboard/resolverTypes.js';
import { headingOutline } from './html/headingLevels.js';
import { removedText } from './html/removedText.js';

vi.mock('./html/normalize.js', async original => {
  const module = await original<typeof NormalizationModule>();
  return { ...module, normalizeClipboardHTML: vi.fn(module.normalizeClipboardHTML) };
});
vi.mock('hast-util-to-html', async original => {
  const module = await original<typeof HTMLSerializationModule>();
  return { ...module, toHtml: vi.fn(module.toHtml) };
});

const normalize = vi.mocked(normalizeClipboardHTML);
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) if (!editor.isDestroyed) editor.destroy();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

interface Fixture {
  editor: Editor;
  normalized: Mock<NonNullable<PasteCleanupOptions['onResult']>>;
  completed: Mock<NonNullable<PasteCleanupOptions['onPasteResult']>>;
  upload: Mock<() => Promise<string>>;
}

function mount(assets = true, options: PasteCleanupOptions = {}, additional: AnyExtension[] = [], allowBase64 = true): Fixture {
  const normalized = vi.fn<NonNullable<PasteCleanupOptions['onResult']>>(result => { options.onResult?.(result); });
  const completed = vi.fn<NonNullable<PasteCleanupOptions['onPasteResult']>>();
  const upload = vi.fn(() => Promise.resolve('/image.png'));
  const editor = new Editor({ content: '<p>Before</p>', extensions: [
    Document, Paragraph, Text, Bold, Heading.configure({ levels: [1, 2, 3, 4] }), History, BulletList, OrderedList, ListItem,
    TextStyle, FontFamily, FontSize, TextColor, TextAlign, Image.configure({ allowBase64, uploadHandler: upload }),
    PasteCleanup.configure({ ...(assets ? { imageAssets: { mode: 'embedded' as const } } : {}), ...options,
      onResult: normalized, onPasteResult: completed }), ...additional,
  ] });
  editors.push(editor);
  editor.view.setProps({ handleScrollToSelection: () => true });
  editor.commands.selectAll();
  normalize.mockClear();
  return { editor, normalized, completed, upload };
}

function clipboard(html: string, files: readonly File[] = []): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    items: [{ kind: 'string', type: 'text/html', getAsFile: () => null }, ...files.map(file => ({
      kind: 'file', type: file.type, getAsFile: () => file,
    }))], files, getData: (type: string) => type === 'text/html' ? html : '',
  } });
  return event as ClipboardEvent;
}

function paste(editor: Editor, html: string, route: 'native' | 'programmatic' | 'without-event' = 'native'): void {
  if (route === 'without-event') editor.view.pasteHTML(html);
  else if (route === 'programmatic') editor.view.pasteHTML(html, clipboard(html));
  else editor.view.dom.dispatchEvent(clipboard(html));
}

const SOURCES = [
  '<p>Plain <strong>bold</strong> text &amp; symbols</p>',
  '<h5>Adapted heading</h5><h2>Supported heading</h2>',
  '<ol start="7"><li><p>Seven</p></li><li><p>Eight</p></li></ol>',
  '<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">7. </span>Seven</p>'
    + '<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">8. </span>Eight</p>',
];

describe('image-free prepared HTML passthrough', () => {
  it.each(['native', 'programmatic'] as const)('normalizes each %s paste once with identical content, diagnostics and Undo', async route => {
    for (const html of SOURCES) {
      const ordinary = mount(false);
      paste(ordinary.editor, html, route);
      expect(normalize).toHaveBeenCalledOnce();
      const expectedNormalization = normalize.mock.results[0]?.value;
      const prepared = mount();
      paste(prepared.editor, html, route);
      expect(normalize).toHaveBeenCalledOnce();
      const actualNormalization = normalize.mock.results[0]?.value;
      expect(actualNormalization).toEqual(expectedNormalization);
      expect(headingOutline(actualNormalization?.result)).toEqual(headingOutline(expectedNormalization?.result));
      expect(prepared.editor.getJSON()).toEqual(ordinary.editor.getJSON());
      expect(prepared.editor.state.doc.textContent).not.toBe('Before');
      expect(prepared.normalized).toHaveBeenCalledOnce();
      expect(undoDepth(prepared.editor.state)).toBe(1);
      await vi.waitFor(() => {
        expect(prepared.completed).toHaveBeenCalledOnce();
        expect(ordinary.completed).toHaveBeenCalledOnce();
      });
      const { operationId: preparedId, references: { referenceId: preparedReference, ...preparedRanges }, ...actual } = prepared.completed.mock.calls[0]![0];
      const { operationId: ordinaryId, references: { referenceId: ordinaryReference, ...ordinaryRanges }, ...expected } = ordinary.completed.mock.calls[0]![0];
      expect(preparedReference).toBe(preparedId);
      expect(ordinaryReference).toBe(ordinaryId);
      expect({ ...actual, references: preparedRanges }).toEqual({ ...expected, references: ordinaryRanges });
      expect(prepared.editor.commands.undo()).toBe(true);
      expect(prepared.editor.state.doc.textContent).toBe('Before');
    }
  });

  it('uses the single normalization route with SmartPaste and Markdown installed', () => {
    const { editor } = mount(true, {}, [SmartPaste, Markdown]);
    paste(editor, '<p>Ordinary <strong>Office</strong> text</p>');
    expect(normalize).toHaveBeenCalledOnce();
    expect(editor.state.doc.textContent).toBe('Ordinary Office text');
    expect(editor.getHTML()).toContain('<strong>Office</strong>');
  });

  it.each([true, false])('reuses image-free resolver preparation with embedding allowed=%s, without calling the adapter', allowBase64 => {
    const resolve = vi.fn<ClipboardResolverAdapter['resolve']>();
    const releaseUncommitted = vi.fn<ClipboardResolverAdapter['releaseUncommitted']>();
    const onRecovery = vi.fn();
    const match = vi.fn(() => []);
    const { editor, normalized, upload } = mount(true, { imageAssets: {
      mode: 'resolver', resolver: { idempotency: 'none', resolve, releaseUncommitted },
      sourcePolicy: { allowedOrigins: ['https://images.example'] }, onRecovery, match,
    } }, [], allowBase64);
    paste(editor, '<p>Text needs no image resolver</p>');
    expect(normalize).toHaveBeenCalledOnce();
    expect(normalized).toHaveBeenCalledOnce();
    expect(editor.state.doc.textContent).toBe('Text needs no image resolver');
    expect(resolve).not.toHaveBeenCalled();
    expect(releaseUncommitted).not.toHaveBeenCalled();
    expect(onRecovery).not.toHaveBeenCalled();
    expect(match).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('keeps the original path when a programmatic paste has no event identity', () => {
    vi.stubGlobal('ClipboardEvent', class extends Event {});
    const { editor } = mount();
    paste(editor, '<p>Programmatic</p>', 'without-event');
    expect(normalize).toHaveBeenCalledTimes(2);
    expect(editor.state.doc.textContent).toBe('Programmatic');
  });

  it.each(['identity', 'changed'] as const)('does not reuse across an earlier %s application transform', kind => {
    const callback = vi.fn((html: string) => kind === 'identity' ? html : '<h6>Changed by application</h6>');
    const earlier = Extension.create({ name: 'earlierHTML', priority: 2000,
      addProseMirrorPlugins: () => [new Plugin({ props: { transformPastedHTML: callback } })],
    });
    const { editor, normalized } = mount(true, {}, [earlier]);
    paste(editor, '<p>Original</p>');
    expect(callback).toHaveBeenCalledOnce();
    expect(normalize).toHaveBeenCalledTimes(2);
    expect(normalized).toHaveBeenCalledOnce();
    expect(editor.state.doc.textContent).toBe(kind === 'identity' ? 'Original' : 'Changed by application');
    if (kind === 'changed') expect(editor.state.doc.firstChild?.attrs['level']).toBe(4);
  });

  it('still normalizes after a direct view transform and lets a later transform run once', () => {
    const fixture = mount();
    const direct = vi.fn((html: string) => html.replace('Original', 'Direct'));
    fixture.editor.view.setProps({ transformPastedHTML: direct });
    paste(fixture.editor, '<p>Original</p>');
    expect(normalize).toHaveBeenCalledTimes(2);
    expect(direct).toHaveBeenCalledOnce();
    expect(fixture.editor.state.doc.textContent).toBe('Direct');

    const callback = vi.fn((html: string) => html.replace('Original', 'Later'));
    const later = Extension.create({ name: 'laterHTML', priority: 1,
      addProseMirrorPlugins: () => [new Plugin({ props: { transformPastedHTML: callback } })],
    });
    const second = mount(true, {}, [later]);
    paste(second.editor, '<p>Original</p>');
    expect(normalize).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledOnce();
    expect(second.editor.state.doc.textContent).toBe('Later');
  });

  it('never reuses one event or one HTML string across separate attempts', () => {
    const { editor, normalized } = mount();
    const html = '<p>Same</p>';
    const event = clipboard(html);
    editor.view.pasteHTML(html, event);
    editor.view.pasteHTML(html, event);
    paste(editor, html);
    expect(normalize).toHaveBeenCalledTimes(3);
    expect(normalized).toHaveBeenCalledTimes(3);
    expect(editor.state.doc.textContent).toBe('SameSameSame');
  });

  it('does not share an outer normalization with a reentrant onResult paste', () => {
    const run = (assets: boolean): ReturnType<Editor['getJSON']> => {
      let nested = false;
      const fixture = mount(assets, { onResult() {
        if (nested) return;
        nested = true;
        paste(fixture.editor, '<p>Inner</p>');
      } });
      paste(fixture.editor, '<p>Outer</p>');
      expect(normalize).toHaveBeenCalledTimes(2);
      expect(fixture.normalized).toHaveBeenCalledTimes(2);
      return fixture.editor.getJSON();
    };
    expect(run(true)).toEqual(run(false));
  });

  it('retains own-copy formatting in adapt mode', () => {
    const source = mount(false);
    source.editor.commands.setContent('<p style="text-align:center"><span style="font-family:Georgia;font-size:18px;color:#123456">Styled copy</span></p>');
    source.editor.commands.selectAll();
    const html = source.editor.view.serializeForClipboard(source.editor.state.selection.content()).dom.innerHTML;
    const { editor } = mount(true, { formatting: 'adapt' });
    paste(editor, html);
    expect(normalize).toHaveBeenCalledOnce();
    expect(editor.getJSON()).toEqual(source.editor.getJSON());
  });

  it('rechecks own-copy identity after an earlier host transform that returns unchanged HTML', () => {
    const source = mount(false);
    source.editor.commands.setContent('<p><span style="font-family:Georgia;color:#123456">Styled copy</span></p>');
    source.editor.commands.selectAll();
    const serialize = (): string => source.editor.view.serializeForClipboard(source.editor.state.selection.content()).dom.innerHTML;
    const html = serialize();
    const earlier = Extension.create({ name: 'expireOwnCopy', priority: 2000, addProseMirrorPlugins: () => [new Plugin({ props: {
      transformPastedHTML(value) {
        // Own-copy recognition deliberately retains only the most recent copies in this realm.
        for (let index = 0; index < 33; index++) serialize();
        return value;
      },
    } })] });
    const { editor } = mount(true, { formatting: 'adapt' }, [earlier]);
    paste(editor, html);
    expect(normalize).toHaveBeenCalledTimes(2);
    expect(editor.state.doc.textContent).toBe('Styled copy');
    expect(editor.getHTML()).not.toContain('font-family');
    expect(editor.getHTML()).not.toContain('color:');
  });

  it('does not reuse a preflight across an editor state change during destination inspection', () => {
    const fixture = mount();
    const original = normalize.getMockImplementation();
    if (original === undefined) throw new Error('Expected the real normalizer behind the observation spy');
    normalize.mockImplementationOnce((...args) => {
      const result = original(...args);
      fixture.editor.view.dispatch(fixture.editor.state.tr.setMeta('host-inspection-state', true));
      return result;
    });
    paste(fixture.editor, '<p>After inspection</p>');
    expect(normalize).toHaveBeenCalledTimes(2);
    expect(fixture.editor.state.doc.textContent).toBe('After inspection');
  });

  it('preserves private hidden-text evidence so a selection image cannot disclose removed text', async () => {
    const { editor, upload } = mount();
    const html = '<p class="MsoNormal" style="display:none;mso-hide:all">Hidden selection</p>';
    const file = new File(['not a valid image'], 'selection.png', { type: 'image/png' });
    const read = vi.fn(() => Promise.resolve(new ArrayBuffer(0)));
    Object.defineProperty(file, 'arrayBuffer', { value: read });
    editor.view.dom.dispatchEvent(clipboard(html, [file]));
    expect(normalize).toHaveBeenCalledOnce();
    expect(removedText(normalize.mock.results[0]?.value?.result)).toBe(true);
    await Promise.resolve();
    expect(read).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(editor.state.doc.textContent).not.toContain('Hidden selection');
    expect(editor.getHTML()).not.toContain('<img');
  });

  it('rejects source limits before host transforms and accepts a following ordinary paste', async () => {
    const callback = vi.fn((html: string) => html);
    const earlier = Extension.create({ name: 'earlierHTML', priority: 2000,
      addProseMirrorPlugins: () => [new Plugin({ props: { transformPastedHTML: callback } })],
    });
    const fixture = mount(true, { limits: { maxNodes: 10 } }, [earlier]);
    paste(fixture.editor, `<div>${'<p>Too many nodes</p>'.repeat(20)}</div>`);
    await vi.waitFor(() => { expect(fixture.completed).toHaveBeenCalledOnce(); });
    expect(fixture.completed.mock.calls[0]?.[0].status).toBe('rejected');
    expect(callback).not.toHaveBeenCalled();
    expect(fixture.editor.state.doc.textContent).toBe('Before');
    paste(fixture.editor, '<p>After</p>');
    expect(fixture.editor.state.doc.textContent).toBe('After');
    expect(callback).toHaveBeenCalledOnce();
  });

  it('does not apply image-output budgets to ordinary image-free HTML', () => {
    const { editor } = mount(true, { imageAssets: { mode: 'embedded', limits: { maxPreparedOutputUnits: 8 } } });
    paste(editor, '<p>This ordinary text exceeds the image output budget.</p>');
    expect(normalize).toHaveBeenCalledOnce();
    expect(editor.state.doc.textContent).toBe('This ordinary text exceeds the image output budget.');
  });

  it('reports a serialization failure once and does not poison the next paste', async () => {
    const fixture = mount();
    vi.mocked(toHtml).mockImplementationOnce(() => { throw new Error('Synthetic serialization failure'); });
    paste(fixture.editor, '<p>Cannot serialize</p>');
    expect(normalize).toHaveBeenCalledOnce();
    expect(fixture.normalized).toHaveBeenCalledOnce();
    expect(fixture.normalized.mock.calls[0]?.[0]).toMatchObject({
      status: 'rejected', html: '', diagnostics: [{ code: 'parse-failed', severity: 'error' }],
    });
    expect(fixture.editor.state.doc.textContent).toBe('Before');
    await vi.waitFor(() => { expect(fixture.completed).toHaveBeenCalledOnce(); });
    expect(fixture.completed.mock.calls[0]?.[0].status).toBe('rejected');
    paste(fixture.editor, '<p>After</p>');
    expect(normalize).toHaveBeenCalledTimes(2);
    expect(fixture.editor.state.doc.textContent).toBe('After');
  });
});
