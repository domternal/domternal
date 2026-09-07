import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, Paragraph, Text } from '@domternal/core';
import type { FloatingMenuItem } from '@domternal/core';
import { DomternalFloatingMenu } from './DomternalFloatingMenu.js';

let root: Root | undefined;
let editor: Editor | undefined;
let host: HTMLElement | undefined;

afterEach(async () => {
  if (root) await act(async () => {
    root?.unmount();
    await Promise.resolve();
  });
  root = undefined;
  editor?.destroy();
  editor = undefined;
  host?.remove();
  host = undefined;
  vi.unstubAllGlobals();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

describe('tutorial menu rendering contracts', () => {
  it('renders optional descriptions as literal text and retains compact, disabled rows', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    host.className = 'dm-editor';
    document.body.appendChild(host);
    // Geometry is covered in browsers; this unit only needs an editor state.
    const mountedEditor = new Editor({ extensions: [Document, Paragraph, Text], content: '<p>Fixture</p>' });
    editor = mountedEditor;
    const items: FloatingMenuItem[] = [
      { name: 'described', label: 'Described', description: 'Résumé <b>literal</b> & 日本語',
        icon: 'textB', shortcut: '#', command: () => undefined },
      { name: 'compact', label: 'Compact', command: () => undefined, isDisabled: () => true },
    ];
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(DomternalFloatingMenu, { editor: mountedEditor, items }));
      await Promise.resolve();
    });
    const described = host.querySelector('[data-floating-menu-item="described"]');
    expect(described?.querySelector('.dm-floating-menu-item-label')?.textContent).toBe('Described');
    expect(described?.querySelector('.dm-floating-menu-item-description')?.textContent)
      .toBe('Résumé <b>literal</b> & 日本語');
    expect(described?.querySelector('b')).toBeNull();
    expect(described?.querySelector('.dm-floating-menu-item-shortcut')?.textContent).toBe('#');
    const compact = host.querySelector<HTMLButtonElement>('[data-floating-menu-item="compact"]');
    expect(compact?.disabled).toBe(true);
    expect(compact?.querySelector('.dm-floating-menu-item-description')).toBeNull();
    expect(compact?.querySelector(':scope > .dm-floating-menu-item-label')?.textContent).toBe('Compact');
  });
});
