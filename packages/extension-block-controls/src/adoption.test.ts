import { afterEach, describe, expect, it } from 'vitest';
import { Document, Editor, Heading, Paragraph, Text } from '@domternal/core';
import { BlockHandle, blockHandlePluginKey } from './BlockHandle.js';
import { BlockContextMenu } from './BlockContextMenu.js';
import { SlashCommand, slashCommandPluginKey } from './SlashCommand.js';

let editor: Editor | undefined;
const hosts: HTMLElement[] = [];

function makeHost(): HTMLElement {
  const host = document.createElement('div');
  host.className = 'dm-editor';
  document.body.appendChild(host);
  hosts.push(host);
  return host;
}

function openContextMenu(host: HTMLElement, anchor: HTMLElement): void {
  host.dispatchEvent(new CustomEvent('dm:block-context-menu-open', {
    detail: { blockPos: 0, anchorElement: anchor },
  }));
}

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  hosts.splice(0).forEach(host => { host.remove(); });
});

describe('block control DOM adoption', () => {
  it('rebinds slash dismissal when an initially detached editor changes hosts', () => {
    editor = new Editor({
      extensions: [Document, Paragraph, Text, SlashCommand.configure({
        render: () => ({
          onStart() { /* No DOM renderer is needed for the host listener. */ },
          onUpdate() { /* No DOM renderer is needed for the host listener. */ },
          onExit() { /* No DOM renderer is needed for the host listener. */ },
          onKeyDown: () => false,
        }),
      })],
      content: '<p></p>',
    });
    const first = makeHost();
    const second = makeHost();
    editor.adoptDom(first);
    editor.view.dispatch(editor.state.tr.insertText('/'));
    expect(slashCommandPluginKey.getState(editor.state)?.active).toBe(true);
    editor.adoptDom(second);
    first.dispatchEvent(new Event('dm:dismiss-overlays'));
    expect(slashCommandPluginKey.getState(editor.state)?.active).toBe(true);
    second.dispatchEvent(new Event('dm:dismiss-overlays'));
    expect(slashCommandPluginKey.getState(editor.state)?.active).toBe(false);
  });

  it('binds detached controls without registering another plugin and moves their host listeners', () => {
    editor = new Editor({
      extensions: [Document, Paragraph, Text, Heading, BlockHandle, BlockContextMenu],
      content: '<p>Hello</p>',
    });
    const plugins = editor.state.plugins;
    const first = makeHost();
    const second = makeHost();
    editor.adoptDom(first);

    expect(editor.state.plugins).toBe(plugins);
    expect(first.querySelector('.dm-block-handle')?.isConnected).toBe(true);
    expect(first.querySelectorAll('.dm-block-context-menu')).toHaveLength(1);
    openContextMenu(first, editor.view.dom);
    expect(first.querySelector('.dm-block-context-menu')?.hasAttribute('data-show')).toBe(true);

    editor.adoptDom(second);
    expect(first.querySelector('.dm-block-handle')).toBeNull();
    expect(first.querySelector('.dm-block-context-menu')).toBeNull();
    expect(first.classList.contains('dm-editor--has-block-handle')).toBe(false);
    expect(first.hasAttribute('data-block-context-menu-open')).toBe(false);
    expect(second.querySelectorAll('.dm-block-handle')).toHaveLength(1);
    const menu = second.querySelector('.dm-block-context-menu');
    expect(menu?.hasAttribute('data-show')).toBe(false);
    openContextMenu(first, editor.view.dom);
    expect(menu?.hasAttribute('data-show')).toBe(false);
    openContextMenu(second, editor.view.dom);
    expect(menu?.hasAttribute('data-show')).toBe(true);
    first.dispatchEvent(new Event('dm:dismiss-overlays'));
    expect(menu?.hasAttribute('data-show')).toBe(true);
    second.dispatchEvent(new Event('dm:dismiss-overlays'));
    expect(menu?.hasAttribute('data-show')).toBe(false);

    editor.adoptDom(second);
    expect(second.querySelectorAll('.dm-block-handle')).toHaveLength(1);
    editor.destroy();
    expect(second.querySelector('.dm-block-handle')).toBeNull();
    expect(second.querySelector('.dm-block-context-menu')).toBeNull();
  });

  it('cleans a detached host and reattaches the same editor controls later', () => {
    const first = makeHost();
    const second = makeHost();
    editor = new Editor({
      element: first,
      extensions: [Document, Paragraph, Text, BlockHandle, BlockContextMenu],
      content: '<p>Hello</p>',
    });
    editor.view.dispatch(editor.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: 0 }));
    const content = editor.getJSON();
    editor.adoptDom(document.createElement('div'));
    expect(editor.view.dom.isConnected).toBe(false);
    expect(first.querySelector('.dm-block-handle')).toBeNull();
    expect(first.querySelector('.dm-block-context-menu')).toBeNull();
    editor.adoptDom(second);
    expect(editor.getJSON()).toEqual(content);
    expect(second.querySelector('.dm-block-handle')?.isConnected).toBe(true);
    openContextMenu(second, editor.view.dom);
    expect(second.querySelector('.dm-block-context-menu')?.hasAttribute('data-show')).toBe(true);
  });
});
