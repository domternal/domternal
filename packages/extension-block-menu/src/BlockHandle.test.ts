import { describe, it, expect, afterEach } from 'vitest';
import {
  Document,
  Text,
  Paragraph,
  Heading,
  Editor,
} from '@domternal/core';
import { BlockHandle, blockHandlePluginKey } from './BlockHandle.js';

const extensions = [Document, Text, Paragraph, Heading, BlockHandle];

let editor: Editor | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  host?.remove();
  host = undefined;
});

function makeEditor(html = '<p>Hello</p>'): Editor {
  host = document.createElement('div');
  host.className = 'dm-editor';
  document.body.appendChild(host);
  editor = new Editor({ element: host, extensions, content: html });
  return editor;
}

describe('BlockHandle configuration', () => {
  it('has the correct extension name', () => {
    expect(BlockHandle.name).toBe('blockHandle');
  });

  it('has default options', () => {
    expect(BlockHandle.options.hideDelay).toBe(200);
    expect(BlockHandle.options.disableDrag).toBe(false);
  });

  it('can configure hideDelay', () => {
    const configured = BlockHandle.configure({ hideDelay: 500 });
    expect(configured.options.hideDelay).toBe(500);
  });

  it('can configure disableDrag', () => {
    const configured = BlockHandle.configure({ disableDrag: true });
    expect(configured.options.disableDrag).toBe(true);
  });
});

describe('BlockHandle plugin state', () => {
  it('initializes with null hoveredPos and draggedFrom', () => {
    const ed = makeEditor();
    const state = blockHandlePluginKey.getState(ed.state);
    expect(state).toEqual({ hoveredPos: null, draggedFrom: null });
  });

  it('updates hoveredPos via meta', () => {
    const ed = makeEditor('<p>first</p><p>second</p>');
    const tr = ed.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: 7 });
    ed.view.dispatch(tr);
    const state = blockHandlePluginKey.getState(ed.state);
    expect(state?.hoveredPos).toBe(7);
    expect(state?.draggedFrom).toBe(null);
  });

  it('updates draggedFrom via meta', () => {
    const ed = makeEditor('<p>A</p>');
    const tr = ed.state.tr.setMeta(blockHandlePluginKey, { draggedFrom: 0 });
    ed.view.dispatch(tr);
    const state = blockHandlePluginKey.getState(ed.state);
    expect(state?.draggedFrom).toBe(0);
  });

  it('maps hoveredPos through doc changes instead of clearing it', () => {
    const ed = makeEditor('<p>A</p><p>B</p>');
    // Set hovered at start of second paragraph (pos 3).
    ed.view.dispatch(ed.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: 3 }));
    expect(blockHandlePluginKey.getState(ed.state)?.hoveredPos).toBe(3);
    // Inserting a char inside the first paragraph shifts positions after it.
    ed.view.dispatch(ed.state.tr.insertText('X', 1));
    // Hovered pos should now be 4 (shifted by +1), not null.
    expect(blockHandlePluginKey.getState(ed.state)?.hoveredPos).toBe(4);
  });

  it('clears hoveredPos when the hovered range is deleted', () => {
    const ed = makeEditor('<p>A</p><p>B</p>');
    ed.view.dispatch(ed.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: 3 }));
    // Delete the second paragraph entirely (positions 3..6).
    ed.view.dispatch(ed.state.tr.delete(3, 6));
    expect(blockHandlePluginKey.getState(ed.state)?.hoveredPos).toBe(null);
  });

  it('preserves draggedFrom across doc changes (drop processed before doc change)', () => {
    const ed = makeEditor('<p>A</p>');
    ed.view.dispatch(ed.state.tr.setMeta(blockHandlePluginKey, { draggedFrom: 0 }));
    ed.view.dispatch(ed.state.tr.insertText('X', 1));
    const state = blockHandlePluginKey.getState(ed.state);
    expect(state?.draggedFrom).toBe(0);
  });

  it('setting hoveredPos to null clears it', () => {
    const ed = makeEditor();
    ed.view.dispatch(ed.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: 1 }));
    ed.view.dispatch(ed.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: null }));
    expect(blockHandlePluginKey.getState(ed.state)?.hoveredPos).toBe(null);
  });

  it('preserves untouched fields across meta updates', () => {
    const ed = makeEditor();
    ed.view.dispatch(ed.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: 5 }));
    ed.view.dispatch(ed.state.tr.setMeta(blockHandlePluginKey, { draggedFrom: 5 }));
    const state = blockHandlePluginKey.getState(ed.state);
    // hoveredPos may have been cleared by the second dispatch if docChanged;
    // since the second dispatch was a meta-only tr, doc is unchanged, so
    // hoveredPos should persist.
    expect(state?.hoveredPos).toBe(5);
    expect(state?.draggedFrom).toBe(5);
  });
});

describe('BlockHandle DOM integration', () => {
  it('mounts a .dm-block-handle element inside .dm-editor', () => {
    makeEditor();
    const handle = host?.querySelector('.dm-block-handle');
    expect(handle).not.toBeNull();
  });

  it('adds `dm-editor--has-block-handle` class to the editor wrapper', () => {
    makeEditor();
    expect(host?.classList.contains('dm-editor--has-block-handle')).toBe(true);
  });

  it('renders drag and plus buttons', () => {
    makeEditor();
    const dragBtn = host?.querySelector('.dm-block-handle-drag');
    const plusBtn = host?.querySelector('.dm-block-handle-plus');
    expect(dragBtn).not.toBeNull();
    expect(plusBtn).not.toBeNull();
    expect(dragBtn?.getAttribute('draggable')).toBe('true');
  });

  it('removes class + DOM when the editor is destroyed', () => {
    makeEditor();
    const hostRef = host;
    editor?.destroy();
    editor = undefined;
    expect(hostRef?.classList.contains('dm-editor--has-block-handle')).toBe(false);
    expect(hostRef?.querySelector('.dm-block-handle')).toBeNull();
  });

  it('handle is hidden initially (no data-show attribute)', () => {
    makeEditor();
    const handle = host?.querySelector('.dm-block-handle');
    expect(handle?.hasAttribute('data-show')).toBe(false);
  });
});
