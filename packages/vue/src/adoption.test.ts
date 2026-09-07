import { createApp, createSSRApp, defineComponent, h, nextTick, ref, type App, type Component, type Ref } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdoptablePluginView, Extension, type Editor } from '@domternal/core';
import { Plugin } from '@domternal/pm/state';
import { Domternal } from './Domternal.js';
import { EditorContent } from './EditorContent.js';
import { provideEditor, useCurrentEditor } from './EditorContext.js';
import { useEditor } from './useEditor.js';
import { useEditorState } from './useEditorState.js';

const HostControl = Extension.create({
  name: 'adoptionTestControl',
  addProseMirrorPlugins() {
    const editor = this.editor as Editor;
    return [new Plugin({
      view: view => createAdoptablePluginView(editor, view, current => {
        const host = current.dom.closest('.dm-editor');
        const control = document.createElement('button');
        control.className = 'test-host-control';
        control.textContent = 'Insert';
        const insert = (): void => {
          editor.view.dispatch(editor.state.tr.insertText('!'));
        };
        control.addEventListener('click', insert);
        host?.appendChild(control);
        return { destroy() {
          control.removeEventListener('click', insert);
          control.remove();
        } };
      }),
    })];
  },
});
const extensions = [HostControl];

let container: HTMLDivElement;
let app: App | undefined;
let editors: Editor[];
const onCreate = (editor: Editor): void => { editors.push(editor); };

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  editors = [];
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  container.remove();
  vi.restoreAllMocks();
});

function compound(immediate: boolean, show: Ref<boolean>): Component {
  return defineComponent({
    setup() {
      return () => h(Domternal, {
        extensions, content: '<p>Hello</p>', immediatelyRender: immediate, onCreate,
      }, { default: () => show.value ? [h(Domternal.Content)] : [] });
    },
  });
}

describe('Vue editor DOM adoption', () => {
  it.each([
    { standalone: false, selector: false },
    { standalone: false, selector: true },
    { standalone: true, selector: false },
    { standalone: true, selector: true },
  ])('does not adopt again when a host plugin notifies Vue state observers: %j', async ({ standalone, selector }) => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
    const flushFrame = async (): Promise<void> => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(performance.now());
      await nextTick();
    };
    const EmitsOnHostBind = Extension.create({
      name: 'emitsOnHostBind',
      addProseMirrorPlugins() {
        const editor = this.editor as Editor;
        return [new Plugin({
          view: view => createAdoptablePluginView(editor, view, current => {
            if (current.dom.closest('.dm-editor')) {
              current.dispatch(current.state.tr.setMeta('hostBound', true).setMeta('addToHistory', false));
            }
            return {};
          }),
        })];
      },
    });
    const observedExtensions = [HostControl, EmitsOnHostBind];
    const Observer = defineComponent({
      setup() {
        const { editor } = useCurrentEditor();
        if (selector) {
          const state = useEditorState(editor, current => ({ text: current.state.doc.textContent }));
          return () => h('output', state.value?.text);
        }
        const state = useEditorState(editor);
        return () => h('output', state.htmlContent.value);
      },
    });
    const show = ref(false);
    app = createApp(defineComponent({
      setup() {
        if (standalone) {
          const { editor } = useEditor({ extensions: observedExtensions, content: '<p>Hello</p>', onCreate });
          provideEditor(editor);
          return () => h('div', { class: 'dm-editor' }, [
            h(Observer), show.value ? h(EditorContent, { editor: editor.value }) : null,
          ]);
        }
        return () => h(Domternal, { extensions: observedExtensions, content: '<p>Hello</p>', onCreate }, {
          default: () => [h(Observer), show.value ? h(Domternal.Content) : null],
        });
      },
    }));
    app.mount(container);
    await nextTick();
    const editor = editors[0]!;
    const adopts = vi.fn();
    editor.on('adopt', adopts);
    show.value = true;
    await nextTick();
    expect(adopts).toHaveBeenCalledTimes(1);
    const view = editor.view;
    // Vue state notifications use a double animation-frame debounce.
    await flushFrame();
    await flushFrame();
    expect(adopts).toHaveBeenCalledTimes(1);
    editor.commands.insertText('Observed ');
    await flushFrame();
    await flushFrame();
    expect(adopts).toHaveBeenCalledTimes(1);
    expect(editor.view).toBe(view);
    expect(container.querySelectorAll('.test-host-control')).toHaveLength(1);
    expect(container.querySelector('output')?.textContent).toBe(selector ? 'Observed Hello' : '<p>Observed Hello</p>');
  });

  it.each([false, true])('mounts compound UI with immediatelyRender=%s', async (immediate) => {
    app = createApp(compound(immediate, ref(true)));
    app.mount(container);
    await nextTick();
    expect(editors).toHaveLength(1);
    const editor = editors[0]!;
    expect(editor.view.dom.isConnected).toBe(true);
    expect(container.querySelectorAll('.test-host-control')).toHaveLength(1);
    container.querySelector<HTMLButtonElement>('.test-host-control')!.click();
    expect(editor.state.doc.textContent).toContain('!');
    app.unmount();
    app = undefined;
    expect(editor.isDestroyed).toBe(true);
    expect(document.querySelector('.test-host-control')).toBeNull();
  });

  it('adopts conditional content and preserves editor state through remount', async () => {
    const show = ref(false);
    app = createApp(compound(false, show));
    app.mount(container);
    await nextTick();
    const editor = editors[0]!;
    expect(editor.view.dom.isConnected).toBe(false);
    show.value = true;
    await nextTick();
    expect(editor.view.dom.isConnected).toBe(true);
    editor.view.dispatch(editor.state.tr.insertText('Saved '));
    const state = editor.state;
    show.value = false;
    await nextTick();
    expect(editor.isDestroyed).toBe(false);
    expect(editor.view.dom.isConnected).toBe(false);
    expect(document.querySelector('.test-host-control')).toBeNull();
    show.value = true;
    await nextTick();
    expect(editors).toHaveLength(1);
    expect(editor.state).toBe(state);
    expect(editor.view.dom.isConnected).toBe(true);
    expect(container.querySelectorAll('.test-host-control')).toHaveLength(1);
  });

  it.each([
    { immediate: false, standalone: false },
    { immediate: true, standalone: false },
    { immediate: false, standalone: true },
    { immediate: true, standalone: true },
  ])('supports direct-ref and standalone hooks: %j', async ({ immediate, standalone }) => {
    app = createApp(defineComponent({
      setup() {
        const { editor, editorRef } = useEditor({
          extensions, content: '<p>Hello</p>', immediatelyRender: immediate, onCreate,
        });
        return () => h('div', { class: 'dm-editor' }, [
          standalone ? h(EditorContent, { editor: editor.value }) : h('div', { ref: editorRef }),
        ]);
      },
    }));
    app.mount(container);
    await nextTick();
    expect(container.querySelector('.ProseMirror')?.isConnected).toBe(true);
    expect(container.querySelectorAll('.test-host-control')).toHaveLength(1);
  });

  it('does not create editor resources during default server rendering', async () => {
    const html = await renderToString(createSSRApp(compound(false, ref(true))));
    expect(html).toContain('dm-editor');
    expect(html).not.toContain('test-host-control');
    expect(editors).toHaveLength(0);
  });

  it('hydrates the default server markup before adopting one live editor', async () => {
    const Component = compound(false, ref(true));
    container.innerHTML = await renderToString(createSSRApp(Component));
    expect(editors).toHaveLength(0);
    const warnings: string[] = [];
    app = createSSRApp(Component);
    app.config.warnHandler = message => { warnings.push(message); };
    app.mount(container);
    await nextTick();
    expect(warnings).toEqual([]);
    expect(editors).toHaveLength(1);
    expect(editors[0]!.view.dom.isConnected).toBe(true);
    expect(container.querySelectorAll('.ProseMirror')).toHaveLength(1);
    expect(container.querySelectorAll('.test-host-control')).toHaveLength(1);
    expect(editors[0]!.state.doc.textContent).toBe('Hello');
  });

  it('keeps two editor instances and their adopted controls isolated', async () => {
    const First = compound(false, ref(true));
    const Second = compound(false, ref(true));
    app = createApp(defineComponent({ setup: () => () => h('div', [h(First), h(Second)]) }));
    app.mount(container);
    await nextTick();
    const controls = container.querySelectorAll<HTMLButtonElement>('.test-host-control');
    expect(controls).toHaveLength(2);
    expect(editors).toHaveLength(2);
    controls[0]!.click();
    expect(editors[0]!.state.doc.textContent).toBe('!Hello');
    expect(editors[1]!.state.doc.textContent).toBe('Hello');
  });
});
