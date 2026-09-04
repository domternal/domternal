import { afterEach, describe, expect, it } from 'vitest';
import { Document, Editor, Extension, ExtensionConfigurationError, History, Paragraph, Text } from '@domternal/core';
import type { EditorOptions } from '@domternal/core';
import { registerClipboardCopyAnnotation, registerClipboardHTMLPreparation } from '@domternal/core/clipboard';
import { Plugin } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import { Image } from '../../extension-image/dist/index.js';
import { PasteCleanup } from './PasteCleanup.js';
import type { PasteCleanupOptions } from './PasteCleanup.js';

type Slot = 'copy annotation' | 'HTML preparation';
interface Rival { view?: EditorView; dispose?: () => void }

const refusals: Readonly<Record<Slot, RegExp>> = {
  'copy annotation': /^This view already has a clipboard copy annotation$/,
  'HTML preparation': /^This view already has a clipboard HTML preparation$/,
};
const embedded: PasteCleanupOptions['imageAssets'] = { mode: 'embedded' };
const editors: Editor[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const editor of editors) if (!editor.isDestroyed) editor.destroy();
  for (const host of hosts) host.remove();
  editors.length = 0;
  hosts.length = 0;
});

/** Another extension that registers one Core clipboard slot from its plugin view. */
function rivalExtension(slot: Slot, priority: number, rival: Rival): Extension {
  return Extension.create({
    name: 'clipboardRival',
    priority,
    addProseMirrorPlugins() {
      return [new Plugin({
        view: view => {
          rival.view = view;
          rival.dispose = slot === 'copy annotation'
            ? registerClipboardCopyAnnotation(view, fragment => { fragment.firstElementChild?.setAttribute('data-rival-copy', ''); })
            : registerClipboardHTMLPreparation(view, () => undefined);
          return { destroy: () => { rival.dispose?.(); } };
        },
      })];
    },
  });
}

function construct(cleanup: PasteCleanupOptions, extra: NonNullable<EditorOptions['extensions']> = []): Editor {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const editor = new Editor({
    element: host,
    content: '<p>Own copy</p>',
    extensions: [Document, Paragraph, Text, History, Image, PasteCleanup.configure(cleanup), ...extra],
  });
  editors.push(editor);
  return editor;
}

function thrown(run: () => unknown): Error {
  try { run(); } catch (error) {
    if (error instanceof Error) return error;
    throw new Error('Expected an Error instance', { cause: error });
  }
  throw new Error('Expected a throw');
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected a value');
  return value;
}

function copy(view: EditorView): string {
  return view.serializeForClipboard(view.state.doc.slice(0, view.state.doc.content.size)).dom.innerHTML;
}

function noticeCount(): number {
  return document.querySelectorAll('.dm-paste-feedback').length;
}

describe('PasteCleanup clipboard slot ownership', () => {
  it.each([
    { label: 'without imageAssets', imageAssets: false as const },
    { label: 'with imageAssets', imageAssets: embedded },
  ])('reports a copy annotation that an earlier registration holds as a configuration error $label', ({ imageAssets }) => {
    const rival: Rival = {};
    const error = thrown(() => construct({ imageAssets }, [rivalExtension('copy annotation', 1300, rival)]));

    expect(error).toBeInstanceOf(ExtensionConfigurationError);
    expect(error.message).toMatch(/^PasteCleanup: this editor already has a clipboard copy annotation, and Core accepts one per editor\./);
    expect(error.message).toContain('registerClipboardCopyAnnotation');
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause).not.toBeInstanceOf(ExtensionConfigurationError);
    expect((error.cause as Error).message).toMatch(refusals['copy annotation']);

    // The earlier registration keeps its slot, and PasteCleanup holds neither slot.
    const view = required(rival.view);
    expect(() => registerClipboardCopyAnnotation(view, () => undefined)).toThrow(refusals['copy annotation']);
    registerClipboardHTMLPreparation(view, () => undefined)();
    required(rival.dispose)();
    registerClipboardCopyAnnotation(view, () => undefined)();
    expect(noticeCount()).toBe(0);
  });

  it('reports an HTML preparation that an earlier registration holds and releases its own copy annotation', () => {
    const rival: Rival = {};
    const error = thrown(() => construct({ imageAssets: embedded }, [rivalExtension('HTML preparation', 1300, rival)]));

    expect(error).toBeInstanceOf(ExtensionConfigurationError);
    expect(error.message).toMatch(/^PasteCleanup: this editor already has a clipboard HTML preparation, and Core accepts one per editor\./);
    expect(error.message).toContain('registerClipboardHTMLPreparation');
    expect(error.message).toContain('imageAssets');
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause).not.toBeInstanceOf(ExtensionConfigurationError);
    expect((error.cause as Error).message).toMatch(refusals['HTML preparation']);

    // PasteCleanup claimed its copy annotation first and gave it back when the preparation was refused.
    const view = required(rival.view);
    registerClipboardCopyAnnotation(view, () => undefined)();
    expect(() => registerClipboardHTMLPreparation(view, () => undefined)).toThrow(refusals['HTML preparation']);
    required(rival.dispose)();
    registerClipboardHTMLPreparation(view, () => undefined)();
    expect(noticeCount()).toBe(0);
  });

  it.each([1300, 100])('leaves the HTML preparation to another registration when imageAssets is off (priority %i)', priority => {
    const rival: Rival = {};
    const editor = construct({}, [rivalExtension('HTML preparation', priority, rival)]);

    expect(rival.view).toBe(editor.view);
    expect(() => registerClipboardHTMLPreparation(editor.view, () => undefined)).toThrow(refusals['HTML preparation']);
    expect(copy(editor.view)).toMatch(/data-domternal-copy="v1\./);
  });

  it.each(['copy annotation', 'HTML preparation'] as const)(
    'refuses a later extension claiming the %s with Core\'s error and keeps PasteCleanup\'s claim',
    slot => {
      const rival: Rival = {};
      const error = thrown(() => construct({ imageAssets: embedded }, [rivalExtension(slot, 100, rival)]));

      expect(error).not.toBeInstanceOf(ExtensionConfigurationError);
      expect(error.message).toMatch(refusals[slot]);
      const view = required(rival.view);
      expect(rival.dispose).toBeUndefined();
      expect(() => registerClipboardCopyAnnotation(view, () => undefined)).toThrow(refusals['copy annotation']);
      expect(() => registerClipboardHTMLPreparation(view, () => undefined)).toThrow(refusals['HTML preparation']);
    },
  );

  it('keeps both slots when application code registers after construction', () => {
    const editor = construct({ imageAssets: embedded });

    const copyRefusal = thrown(() => registerClipboardCopyAnnotation(editor.view, fragment => {
      fragment.firstElementChild?.setAttribute('data-rival-copy', '');
    }));
    const preparationRefusal = thrown(() => registerClipboardHTMLPreparation(editor.view, () => undefined));

    expect(copyRefusal).not.toBeInstanceOf(ExtensionConfigurationError);
    expect(copyRefusal.message).toMatch(refusals['copy annotation']);
    expect(preparationRefusal).not.toBeInstanceOf(ExtensionConfigurationError);
    expect(preparationRefusal.message).toMatch(refusals['HTML preparation']);
    const html = copy(editor.view);
    expect(html).toMatch(/data-domternal-copy="v1\./);
    expect(html).not.toContain('data-rival-copy');
  });

  it('releases both slots with its plugin view and claims them again when plugin views are recreated', () => {
    const editor = construct({ imageAssets: embedded });
    const plugins = editor.state.plugins;

    editor.view.updateState(editor.state.reconfigure({ plugins: [] }));
    registerClipboardCopyAnnotation(editor.view, () => undefined)();
    registerClipboardHTMLPreparation(editor.view, () => undefined)();

    editor.view.updateState(editor.state.reconfigure({ plugins }));
    expect(copy(editor.view)).toMatch(/data-domternal-copy="v1\./);
    expect(() => registerClipboardHTMLPreparation(editor.view, () => undefined)).toThrow(refusals['HTML preparation']);
  });
});
