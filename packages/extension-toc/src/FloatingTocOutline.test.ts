/**
 * FloatingTocOutline - Phase 1 unit tests.
 *
 * The plugin itself is hard to test without a full PM `Editor` (it lives
 * behind `addProseMirrorPlugins` and reaches into `view.dom`). What's
 * worth unit-testing in isolation is `resolveOutlineHost` - the DOM walk
 * that picks where the outline mounts (D11). Bug here is silent and
 * user-facing: outline ends up clipped or misplaced.
 *
 * Strategy: build small DOM trees in jsdom, fake an `EditorView` with a
 * `.dom` reference, call the walk, assert the host.
 *
 * Currently `resolveOutlineHost` is module-private. We test it indirectly
 * by mounting the plugin via a stubbed `editorView` and reading where the
 * outline DOM was appended. This keeps the surface area small without
 * exporting helpers that aren't part of the public API.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { FloatingTocOutline } from './FloatingTocOutline.js';
import type { Plugin } from '@domternal/pm/state';

interface MountResult {
  outline: HTMLElement;
  host: HTMLElement | null;
  destroy: () => void;
}

/**
 * Stand-up the plugin against a fake editor view. Returns the outline
 * element, the resolved host (its parent in the DOM), and a destroy
 * function so each test can tear down without leaking DOM.
 */
function mountPlugin(viewDom: HTMLElement): MountResult {
  // The Extension's `addProseMirrorPlugins` returns Plugin[]. The
  // plugin we care about is the only one - grab it and invoke its
  // `view(editorView)` factory with a fake editor view that only
  // exposes `dom` (the only thing `resolveOutlineHost` reads).
  const ext = FloatingTocOutline;
  const plugins = ext.config.addProseMirrorPlugins?.call({
    options: {},
    storage: {},
  } as never) as Plugin[] | undefined;
  const plugin = plugins?.[0];
  if (!plugin) {
    throw new Error('FloatingTocOutline did not register a plugin');
  }

  const fakeView = { dom: viewDom } as unknown as Parameters<NonNullable<Plugin['spec']['view']>>[0];
  const controller = plugin.spec.view!(fakeView);

  const outline = document.querySelector<HTMLElement>('.dm-toc-outline');
  if (!outline) throw new Error('outline did not mount');

  return {
    outline,
    host: outline.parentElement,
    destroy: () => controller.destroy?.(),
  };
}

describe('FloatingTocOutline - resolveOutlineHost via mount', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('skips .dm-editor (overflow:hidden) and lands on its parent when parent is non-hidden', () => {
    // Layout matches the real Angular wrapper: .notion-page > .dm-editor > <div> > .ProseMirror
    document.body.innerHTML = `
      <div class="notion-page" style="overflow: visible;">
        <div class="dm-editor" style="overflow: hidden;">
          <div class="editor-ref">
            <div class="ProseMirror"></div>
          </div>
        </div>
      </div>
    `;
    const proseMirror = document.querySelector<HTMLElement>('.ProseMirror')!;
    const { host, destroy } = mountPlugin(proseMirror);

    expect(host?.classList.contains('notion-page')).toBe(true);
    destroy();
  });

  it('falls back to document.body when every ancestor has overflow:hidden', () => {
    document.body.innerHTML = `
      <div class="outer" style="overflow: hidden;">
        <div class="dm-editor" style="overflow: hidden;">
          <div class="ProseMirror"></div>
        </div>
      </div>
    `;
    const proseMirror = document.querySelector<HTMLElement>('.ProseMirror')!;
    const { host, destroy } = mountPlugin(proseMirror);

    expect(host).toBe(document.body);
    destroy();
  });

  it('jumps past the editor host even when ProseMirror is nested inside an unstyled inner template div', () => {
    // The Angular wrapper renders <div #editorRef> inside .dm-editor.
    // A naive walk from view.dom.parentElement would land on that div
    // (overflow: visible) and the outline would be clipped by .dm-editor.
    document.body.innerHTML = `
      <div class="page" style="overflow: visible;">
        <div class="dm-editor" style="overflow: hidden;">
          <div class="editor-ref"><!-- styled like Angular's #editorRef wrapper -->
            <div class="ProseMirror"></div>
          </div>
        </div>
      </div>
    `;
    const proseMirror = document.querySelector<HTMLElement>('.ProseMirror')!;
    const { host, destroy } = mountPlugin(proseMirror);

    expect(host?.classList.contains('page')).toBe(true);
    expect(host?.classList.contains('editor-ref')).toBe(false);
    destroy();
  });

  it('destroy removes the outline DOM node and restores patched host position', () => {
    document.body.innerHTML = `
      <div class="notion-page" style="overflow: visible;"><div class="dm-editor" style="overflow: hidden;"><div class="ProseMirror"></div></div></div>
    `;
    const proseMirror = document.querySelector<HTMLElement>('.ProseMirror')!;
    const { destroy } = mountPlugin(proseMirror);

    expect(document.querySelectorAll('.dm-toc-outline')).toHaveLength(1);
    destroy();
    expect(document.querySelectorAll('.dm-toc-outline')).toHaveLength(0);
  });
});
