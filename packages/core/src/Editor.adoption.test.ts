import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from './Editor.js';
import { Document } from './nodes/Document.js';
import { Paragraph } from './nodes/Paragraph.js';
import { Text } from './nodes/Text.js';
import { History } from './extensions/History.js';
import { Plugin } from '@domternal/pm/state';
import { createAdoptablePluginView } from './utils/createAdoptablePluginView.js';

const extensions = [Document, Paragraph, Text, History];
let editor: Editor | undefined;
const hosts: HTMLElement[] = [];

function makeHost(connected = true): { host: HTMLElement; mount: HTMLElement } {
  const host = document.createElement('div');
  host.className = 'dm-editor';
  const mount = document.createElement('div');
  host.appendChild(mount);
  if (connected) document.body.appendChild(host);
  hosts.push(host);
  return { host, mount };
}

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  hosts.splice(0).forEach(host => { host.remove(); });
});

describe('Editor DOM adoption', () => {
  it('preserves the view, state, selection and history without repeating creation events', () => {
    const onMount = vi.fn();
    const onCreate = vi.fn();
    editor = new Editor({ extensions, content: '<p>Hello</p>', onMount, onCreate });
    editor.view.dispatch(editor.state.tr.insertText('!'));
    const view = editor.view;
    const state = editor.state;
    const onAdopt = vi.fn();
    editor.on('adopt', onAdopt);
    const { host, mount } = makeHost();

    expect(editor.adoptDom(mount)).toBe(editor);
    expect(view.dom.isConnected).toBe(true);
    expect(view.dom.parentElement).toBe(mount);
    expect(editor.view).toBe(view);
    expect(editor.state).toBe(state);
    expect(onAdopt).toHaveBeenCalledExactlyOnceWith({
      editor, view, element: mount, host, previousHost: null,
    });
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.state.doc.textContent).toBe('Hello');
  });

  it('is idempotent but notices connecting an existing detached host', () => {
    const { host, mount } = makeHost(false);
    editor = new Editor({ extensions, element: mount });
    const onAdopt = vi.fn();
    editor.on('adopt', onAdopt);
    editor.adoptDom(mount);
    expect(onAdopt).not.toHaveBeenCalled();

    document.body.appendChild(host);
    editor.adoptDom(mount);
    editor.adoptDom(mount);
    expect(onAdopt).toHaveBeenCalledTimes(1);
  });

  it('transfers owned preset classes and preserves caller-owned classes', () => {
    const first = makeHost();
    const second = makeHost();
    const third = makeHost();
    third.host.classList.add('dm-notion-mode');
    editor = new Editor({ extensions, element: first.mount, preset: 'notion' });

    editor.adoptDom(second.mount);
    expect(first.host.classList.contains('dm-notion-mode')).toBe(false);
    expect(second.host.classList.contains('dm-notion-mode')).toBe(true);
    editor.adoptDom(third.mount);
    expect(second.host.classList.contains('dm-notion-mode')).toBe(false);
    editor.destroy();
    expect(third.host.classList.contains('dm-notion-mode')).toBe(true);
  });

  it('notices reparenting the same host and refreshes the ProseMirror root', () => {
    const { host, mount } = makeHost();
    const outer = document.createElement('div');
    document.body.appendChild(outer);
    hosts.push(outer);
    editor = new Editor({ extensions, element: mount });
    const onAdopt = vi.fn();
    editor.on('adopt', onAdopt);
    outer.appendChild(host);
    editor.adoptDom(mount);
    expect(onAdopt).toHaveBeenCalledTimes(1);

    const shadowRoot = outer.attachShadow({ mode: 'open' });
    shadowRoot.appendChild(host);
    editor.adoptDom(mount);
    expect(editor.view.root).toBe(shadowRoot);
    expect(onAdopt).toHaveBeenCalledTimes(2);
  });

  it('ignores adoption after destruction', () => {
    editor = new Editor({ extensions });
    editor.destroy();
    const { mount } = makeHost();
    expect(editor.adoptDom(mount)).toBe(editor);
    expect(mount.childElementCount).toBe(0);
  });
});

describe('adoptable plugin views', () => {
  it('rebinds only its own UI and cleans old listeners without resetting plugin state', () => {
    editor = new Editor({ extensions, content: '<p>Hello</p>' });
    const ed = editor;
    const listener = vi.fn();
    const setup = vi.fn();
    const cleanup = vi.fn();
    const state = {};
    const stableDestroy = vi.fn();
    ed.registerPlugin(new Plugin({ view: () => ({ destroy: stableDestroy }) }));
    ed.registerPlugin(new Plugin({
      state: { init: () => state, apply: (_tr, previous) => previous },
      view: view => createAdoptablePluginView(ed, view, current => {
        setup();
        const host = current.dom.closest('.dm-editor');
        host?.addEventListener('test-adoption', listener);
        return { destroy() {
          cleanup();
          host?.removeEventListener('test-adoption', listener);
        } };
      }),
    }));
    stableDestroy.mockClear();
    const first = makeHost();
    const second = makeHost();
    const editorState = ed.state;

    ed.adoptDom(first.mount);
    first.host.dispatchEvent(new Event('test-adoption'));
    ed.adoptDom(second.mount);
    first.host.dispatchEvent(new Event('test-adoption'));
    second.host.dispatchEvent(new Event('test-adoption'));
    ed.adoptDom(second.mount);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(setup).toHaveBeenCalledTimes(3);
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(stableDestroy).not.toHaveBeenCalled();
    expect(ed.state).toBe(editorState);
    ed.destroy();
    second.host.dispatchEvent(new Event('test-adoption'));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledTimes(3);
  });
});
