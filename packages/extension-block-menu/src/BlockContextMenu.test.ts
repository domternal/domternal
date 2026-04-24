import { describe, it, expect, afterEach } from 'vitest';
import {
  Document,
  Text,
  Paragraph,
  Heading,
  Blockquote,
  CodeBlock,
  BulletList,
  OrderedList,
  Editor,
} from '@domternal/core';
import { BlockContextMenu } from './BlockContextMenu.js';

const extensions = [Document, Text, Paragraph, Heading, Blockquote, CodeBlock, BulletList, OrderedList, BlockContextMenu];

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

/**
 * Dispatch the custom `dm:block-context-menu-open` event that BlockHandle
 * emits on click. Simulates the integration without going through the
 * drag-handle DOM path.
 */
function openContextMenu(blockPos: number, anchor?: HTMLElement): void {
  const fallback = host ? host.querySelector<HTMLElement>('.ProseMirror') : null;
  const anchorEl = anchor ?? fallback;
  if (!anchorEl) return;
  host?.dispatchEvent(
    new CustomEvent('dm:block-context-menu-open', {
      detail: { blockPos, anchorElement: anchorEl },
    }),
  );
}

describe('BlockContextMenu configuration', () => {
  it('has the correct extension name', () => {
    expect(BlockContextMenu.name).toBe('blockContextMenu');
  });

  it('has turnIntoEnabled=true by default', () => {
    expect(BlockContextMenu.options.turnIntoEnabled).toBe(true);
  });

  it('ships default turnIntoTargets list', () => {
    expect(Array.isArray(BlockContextMenu.options.turnIntoTargets)).toBe(true);
    expect((BlockContextMenu.options.turnIntoTargets ?? []).length).toBeGreaterThan(0);
    const names = (BlockContextMenu.options.turnIntoTargets ?? []).map((t) => t.nodeType);
    expect(names).toContain('paragraph');
    expect(names).toContain('heading');
    expect(names).toContain('blockquote');
  });

  it('can override turnIntoEnabled', () => {
    const configured = BlockContextMenu.configure({ turnIntoEnabled: false });
    expect(configured.options.turnIntoEnabled).toBe(false);
  });

  it('can override turnIntoTargets', () => {
    const configured = BlockContextMenu.configure({
      turnIntoTargets: [{ label: 'Plain', icon: 'textT', nodeType: 'paragraph' }],
    });
    expect(configured.options.turnIntoTargets).toHaveLength(1);
    expect(configured.options.turnIntoTargets?.[0]?.label).toBe('Plain');
  });
});

describe('BlockContextMenu DOM integration', () => {
  it('mounts a .dm-block-context-menu element inside .dm-editor', () => {
    makeEditor();
    const menu = host?.querySelector('.dm-block-context-menu');
    expect(menu).not.toBeNull();
  });

  it('applies role="menu" and aria-label to the popup', () => {
    makeEditor();
    const menu = host?.querySelector('.dm-block-context-menu');
    expect(menu?.getAttribute('role')).toBe('menu');
    expect(menu?.getAttribute('aria-label')).toBe('Block options');
  });

  it('removes DOM on editor destroy', () => {
    makeEditor();
    const hostRef = host;
    editor?.destroy();
    editor = undefined;
    expect(hostRef?.querySelector('.dm-block-context-menu')).toBeNull();
  });

  it('is hidden initially (no data-show)', () => {
    makeEditor();
    const menu = host?.querySelector('.dm-block-context-menu');
    expect(menu?.hasAttribute('data-show')).toBe(false);
  });

  it('shows menu with Delete + Duplicate + Turn into items on open', () => {
    makeEditor('<p>Target</p>');
    openContextMenu(0);
    const menu = host?.querySelector('.dm-block-context-menu');
    expect(menu?.hasAttribute('data-show')).toBe(true);
    const items = menu?.querySelectorAll('.dm-block-context-menu-item');
    expect((items?.length ?? 0)).toBeGreaterThan(2);
    // Labels are stored in aria-label; verify core actions present.
    const labels = Array.from(items ?? []).map((b) => b.getAttribute('aria-label'));
    expect(labels).toContain('Delete');
    expect(labels).toContain('Duplicate');
  });

  it('omits Duplicate for horizontal rules (though HR not in this test setup, renders dynamic)', () => {
    // Paragraph has Duplicate visible — verifies dynamic rendering decision.
    makeEditor('<p>X</p>');
    openContextMenu(0);
    const items = host?.querySelectorAll('.dm-block-context-menu-item');
    const labels = Array.from(items ?? []).map((b) => b.getAttribute('aria-label'));
    expect(labels).toContain('Duplicate');
  });

  it('filters out the current block type from Turn into targets', () => {
    makeEditor('<h2>Title</h2>');
    openContextMenu(0);
    const items = host?.querySelectorAll('.dm-block-context-menu-item');
    const labels = Array.from(items ?? []).map((b) => b.getAttribute('aria-label'));
    // Heading 2 is current → should not appear as a Turn into target.
    expect(labels).not.toContain('Heading 2');
    // Other heading levels should still be offered.
    expect(labels).toContain('Heading 1');
  });

  it('closes on dm:dismiss-overlays event', () => {
    makeEditor('<p>Test</p>');
    openContextMenu(0);
    const menu = host?.querySelector('.dm-block-context-menu');
    expect(menu?.hasAttribute('data-show')).toBe(true);
    host?.dispatchEvent(new Event('dm:dismiss-overlays'));
    expect(menu?.hasAttribute('data-show')).toBe(false);
  });

  it('hides Turn into section when turnIntoEnabled is false', () => {
    const disabled = BlockContextMenu.configure({ turnIntoEnabled: false });
    const customExtensions = [Document, Text, Paragraph, Heading, disabled];
    host = document.createElement('div');
    host.className = 'dm-editor';
    document.body.appendChild(host);
    editor = new Editor({ element: host, extensions: customExtensions, content: '<p>x</p>' });
    openContextMenu(0);
    const labels = Array.from(host.querySelectorAll('.dm-block-context-menu-item'))
      .map((b) => b.getAttribute('aria-label'));
    // Primary actions present, turn-into targets absent.
    expect(labels).toContain('Delete');
    expect(labels).not.toContain('Heading 1');
  });
});
