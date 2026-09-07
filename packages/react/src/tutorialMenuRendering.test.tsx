import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, Paragraph, Text } from '@domternal/core';
import type { FloatingMenuItem, ToolbarDropdown } from '@domternal/core';
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

  it.each([
    ['Macintosh', '⌘⇧X'],
    ['X11; Linux x86_64', 'Ctrl+Shift+X'],
  ])('keeps ordinary, color and reset titles and labels on %s', async (userAgent, shortcut) => {
    // Platform detection is intentionally fixed when the formatter is loaded.
    vi.resetModules();
    vi.stubGlobal('navigator', { userAgent });
    const { createElement: element } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { ToolbarDropdownPanel } = await import('./toolbar/ToolbarDropdownPanel.js');
    const dropdown: ToolbarDropdown = {
      type: 'dropdown', name: 'colors', label: 'Colors', icon: '',
      items: [
        { type: 'button', name: 'color', label: 'Red', color: '#ff0000', icon: '', command: 'setTextColor', shortcut: 'Mod-Shift-X' },
        { type: 'button', name: 'reset', label: 'Reset', icon: '', command: 'unsetTextColor', shortcut: 'Mod-Shift-X' },
        { type: 'button', name: 'plain', label: 'Blue', color: '#0000ff', icon: '', command: 'setTextColor' },
      ],
    };
    for (const layout of ['list', 'grid'] as const) {
      const output = document.createElement('div');
      output.innerHTML = renderToStaticMarkup(element(ToolbarDropdownPanel, {
        dropdown: { ...dropdown, layout },
        isActive: () => false,
        getCachedItemContent: (_icon: string, label: string) => label,
        onItemClick: () => undefined,
      }));
      const buttons = Array.from(output.querySelectorAll('button'));
      expect(buttons.map(button => button.title)).toEqual([`Red (${shortcut})`, `Reset (${shortcut})`, 'Blue']);
      expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual(['Red', 'Reset', 'Blue']);
      expect(buttons.every(button => button.type === 'button' && button.getAttribute('role') === 'menuitem')).toBe(true);
      if (layout === 'grid') {
        expect(buttons[0]?.classList.contains('dm-color-swatch')).toBe(true);
        expect(buttons[1]?.classList.contains('dm-color-palette-reset')).toBe(true);
      }
    }
  });
});
