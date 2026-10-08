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
interface Rival { view?: EditorView; dispose?: () => void; destroyed: number }

const refusals: Readonly<Record<Slot, RegExp>> = {
  'copy annotation': /^This view already has a clipboard copy annotation$/,
  'HTML preparation': /^This view already has a clipboard HTML preparation$/,
};
const guidance: Readonly<Record<Slot, RegExp>> = {
  'copy annotation': /^PasteCleanup: this editor already has a clipboard copy annotation, and Core accepts one per editor\./,
  'HTML preparation': /^PasteCleanup: this editor already has a clipboard HTML preparation, and Core accepts one per editor\./,
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

/** A plugin whose view registers one Core clipboard slot, as another extension or application would. */
function rivalPlugin(slot: Slot, rival: Rival): Plugin {
  return new Plugin({
    view: view => {
      rival.view = view;
      rival.dispose = slot === 'copy annotation'
        ? registerClipboardCopyAnnotation(view, fragment => { fragment.firstElementChild?.setAttribute('data-rival-copy', ''); })
        : registerClipboardHTMLPreparation(view, () => undefined);
      return { destroy: () => { rival.destroyed++; rival.dispose?.(); } };
    },
  });
}

function rivalExtension(slot: Slot, priority: number, rival: Rival): Extension {
  return Extension.create({ name: 'clipboardRival', priority, addProseMirrorPlugins: () => [rivalPlugin(slot, rival)] });
}

function mountHost(): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  return host;
}

function construct(cleanup: PasteCleanupOptions, extra: NonNullable<EditorOptions['extensions']> = [], host = mountHost()): Editor {
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

function expectGuidance(error: Error, slot: Slot): void {
  expect(error).toBeInstanceOf(ExtensionConfigurationError);
  expect(error.message).toMatch(guidance[slot]);
  expect(error.message).toContain(slot === 'copy annotation' ? 'registerClipboardCopyAnnotation' : 'registerClipboardHTMLPreparation');
  expect(error.cause).toBeInstanceOf(Error);
  expect(error.cause).not.toBeInstanceOf(ExtensionConfigurationError);
  expect((error.cause as Error).message).toMatch(refusals[slot]);
}

/** Recreates the editor's plugin views with the rival's plugin first, so its view claims the slot before PasteCleanup's. */
function reconfigureWithRivalFirst(editor: Editor, slot: Slot, rival: Rival): Error {
  const plugins = [rivalPlugin(slot, rival), ...editor.state.plugins];
  return thrown(() => { editor.view.updateState(editor.state.reconfigure({ plugins })); });
}

describe('PasteCleanup clipboard slot ownership', () => {
  it.each([
    { label: 'without imageAssets', imageAssets: false as const },
    { label: 'with imageAssets', imageAssets: embedded },
  ])('reports a copy annotation that an earlier plugin view holds as a configuration error $label and leaves nothing running', ({ imageAssets }) => {
    const rival: Rival = { destroyed: 0 };
    const host = mountHost();
    const error = thrown(() => construct({ imageAssets }, [rivalExtension('copy annotation', 1300, rival)], host));

    expectGuidance(error, 'copy annotation');
    // Core tears the failed editor down: the earlier plugin view is destroyed and releases its slot.
    expect(required(rival.view).isDestroyed).toBe(true);
    expect(rival.destroyed).toBe(1);
    expect(host.childNodes).toHaveLength(0);
    expect(noticeCount()).toBe(0);
  });

  it('reports an HTML preparation that an earlier plugin view holds as a configuration error and leaves nothing running', () => {
    const rival: Rival = { destroyed: 0 };
    const host = mountHost();
    const error = thrown(() => construct({ imageAssets: embedded }, [rivalExtension('HTML preparation', 1300, rival)], host));

    expectGuidance(error, 'HTML preparation');
    expect(error.message).toContain('imageAssets');
    expect(required(rival.view).isDestroyed).toBe(true);
    expect(rival.destroyed).toBe(1);
    expect(host.childNodes).toHaveLength(0);
    expect(noticeCount()).toBe(0);
  });

  it('claims nothing when a reconfiguration puts another copy annotation first', () => {
    const editor = construct({ imageAssets: embedded });
    const rival: Rival = { destroyed: 0 };

    expectGuidance(reconfigureWithRivalFirst(editor, 'copy annotation', rival), 'copy annotation');

    // The view stays alive, the other registration keeps its slot and PasteCleanup holds neither slot.
    expect(rival.view).toBe(editor.view);
    expect(() => registerClipboardCopyAnnotation(editor.view, () => undefined)).toThrow(refusals['copy annotation']);
    registerClipboardHTMLPreparation(editor.view, () => undefined)();
    expect(noticeCount()).toBe(0);
    required(rival.dispose)();
    registerClipboardCopyAnnotation(editor.view, () => undefined)();
  });

  it('releases its copy annotation when a reconfiguration puts another HTML preparation first', () => {
    const editor = construct({ imageAssets: embedded });
    const rival: Rival = { destroyed: 0 };

    const error = reconfigureWithRivalFirst(editor, 'HTML preparation', rival);
    expectGuidance(error, 'HTML preparation');

    // PasteCleanup claimed its copy annotation first and gave it back when the preparation was refused.
    expect(rival.view).toBe(editor.view);
    registerClipboardCopyAnnotation(editor.view, () => undefined)();
    expect(() => registerClipboardHTMLPreparation(editor.view, () => undefined)).toThrow(refusals['HTML preparation']);
    expect(noticeCount()).toBe(0);
    required(rival.dispose)();
    registerClipboardHTMLPreparation(editor.view, () => undefined)();
  });

  it.each([1300, 100])('leaves the HTML preparation to another registration when imageAssets is off (priority %i)', priority => {
    const rival: Rival = { destroyed: 0 };
    const editor = construct({}, [rivalExtension('HTML preparation', priority, rival)]);

    expect(rival.view).toBe(editor.view);
    expect(() => registerClipboardHTMLPreparation(editor.view, () => undefined)).toThrow(refusals['HTML preparation']);
    expect(copy(editor.view)).toMatch(/data-domternal-copy="v1\./);
  });

  it.each(['copy annotation', 'HTML preparation'] as const)(
    'fails new Editor with Core\'s error when a later plugin view claims the %s, and the teardown releases PasteCleanup',
    slot => {
      const rival: Rival = { destroyed: 0 };
      const host = mountHost();
      const error = thrown(() => construct({ imageAssets: embedded }, [rivalExtension(slot, 100, rival)], host));

      expect(error).not.toBeInstanceOf(ExtensionConfigurationError);
      expect(error.message).toMatch(refusals[slot]);
      expect(rival.dispose).toBeUndefined();
      // PasteCleanup's view was created and claimed both slots; Core destroys it with the failed editor.
      expect(required(rival.view).isDestroyed).toBe(true);
      expect(host.childNodes).toHaveLength(0);
      expect(noticeCount()).toBe(0);
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
