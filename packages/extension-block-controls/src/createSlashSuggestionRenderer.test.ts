import { describe, it, expect, afterEach, vi } from 'vitest';
import { Document, Text, Paragraph, Editor } from '@domternal/core';
import type { FloatingMenuItem } from '@domternal/core';
import { createSlashSuggestionRenderer } from './createSlashSuggestionRenderer.js';
import type { SlashCommandProps } from './SlashCommand.js';

let host: HTMLElement | undefined;
let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  host?.remove();
  host = undefined;
  // Sweep any stray menu DOM left over from failed tests.
  document.querySelectorAll('.dm-slash-command-menu').forEach((el) => { el.remove(); });
});

function makeEditor(): Editor {
  host = document.createElement('div');
  host.className = 'dm-editor';
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: [Document, Text, Paragraph],
    content: '<p>Hello</p>',
  });
  return editor;
}

function makeProps(items: FloatingMenuItem[], commandSpy?: (item: FloatingMenuItem) => void): SlashCommandProps {
  const ed = editor ?? makeEditor();
  return {
    editor: ed,
    query: '',
    range: { from: 0, to: 1 },
    items,
    command: commandSpy ?? vi.fn(),
    clientRect: (): DOMRect => new DOMRect(100, 100, 0, 20),
    element: ed.view.dom,
  };
}

const itemA: FloatingMenuItem = {
  // `textHOne` is the actual key in `defaultIcons` (Phosphor name).
  name: 'a', label: 'Heading 1', icon: 'textHOne', keywords: ['h1'],
  command: 'toggleHeading', group: 'Basics',
};
const itemB: FloatingMenuItem = {
  name: 'b', label: 'Bullet list', icon: 'list', keywords: ['bullet'],
  command: 'toggleBulletList', group: 'Basics', shortcut: 'Ctrl+Shift+8',
  description: 'Unordered list',
};
const itemC: FloatingMenuItem = {
  name: 'c', label: 'Code block', keywords: ['code'],
  command: 'toggleCodeBlock', // no group, no icon, no shortcut
};

describe('createSlashSuggestionRenderer - mount lifecycle', () => {
  it('onStart appends a root .dm-slash-command-menu to .dm-editor', () => {
    makeEditor();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA]));

    const root = host?.querySelector('.dm-slash-command-menu');
    expect(root).not.toBeNull();
    expect(root?.getAttribute('role')).toBe('menu');
    expect(root?.getAttribute('aria-label')).toBe('Insert block');
    expect(root?.hasAttribute('data-show')).toBe(true);
    renderer.onExit();
  });

  it('onStart falls back to document.body when no .dm-editor ancestor exists', () => {
    // No host - mount editor without .dm-editor wrapper class.
    const orphan = document.createElement('div');
    document.body.appendChild(orphan);
    editor = new Editor({
      element: orphan,
      extensions: [Document, Text, Paragraph],
      content: '<p>x</p>',
    });
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA]));
    // Root attached to body, not the orphan.
    const bodyRoot = document.body.querySelector(':scope > .dm-slash-command-menu');
    expect(bodyRoot).not.toBeNull();
    renderer.onExit();
    orphan.remove();
  });

  it('onExit removes the root + clears internal refs', () => {
    makeEditor();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA]));
    renderer.onExit();

    expect(host?.querySelector('.dm-slash-command-menu')).toBeNull();
  });

  it('onUpdate replaces the popup contents', () => {
    makeEditor();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA]));
    renderer.onUpdate(makeProps([itemA, itemB]));

    const buttons = host?.querySelectorAll('.dm-slash-command-item');
    expect(buttons?.length).toBe(2);
    renderer.onExit();
  });

  it('onUpdate before onStart is a no-op (root null)', () => {
    makeEditor();
    const renderer = createSlashSuggestionRenderer();
    expect(() => { renderer.onUpdate(makeProps([itemA])); }).not.toThrow();
  });
});

describe('createSlashSuggestionRenderer - rendered DOM', () => {
  it('renders a "No matches" status when items array is empty', () => {
    makeEditor();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([]));

    const empty = host?.querySelector('.dm-slash-command-empty');
    expect(empty).not.toBeNull();
    expect(empty?.getAttribute('role')).toBe('status');
    expect(empty?.getAttribute('aria-live')).toBe('polite');
    expect(empty?.textContent).toBe('No matches');
    renderer.onExit();
  });

  it('renders group headers and group container with role=group', () => {
    makeEditor();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA, itemB]));

    const label = host?.querySelector('.dm-slash-command-group-label');
    const groupEl = host?.querySelector('.dm-slash-command-group');
    expect(label?.textContent).toBe('Basics');
    expect(groupEl?.getAttribute('role')).toBe('group');
    expect(groupEl?.getAttribute('aria-label')).toBe('Basics');
    renderer.onExit();
  });

  it('renders icon span only when item has icon', () => {
    makeEditor();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA, itemC])); // C has no icon

    const buttons = Array.from(host?.querySelectorAll<HTMLButtonElement>('.dm-slash-command-item') ?? []);
    expect(buttons[0]?.querySelector('.dm-slash-command-item-icon')).not.toBeNull();
    expect(buttons[1]?.querySelector('.dm-slash-command-item-icon')).toBeNull();
    renderer.onExit();
  });

  it('renders description span only when item has description', () => {
    makeEditor();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA, itemB])); // B has description

    const buttons = Array.from(host?.querySelectorAll<HTMLButtonElement>('.dm-slash-command-item') ?? []);
    expect(buttons[0]?.querySelector('.dm-slash-command-item-description')).toBeNull();
    expect(buttons[1]?.querySelector('.dm-slash-command-item-description')?.textContent).toBe('Unordered list');
    renderer.onExit();
  });

  it('renders shortcut chip only when item has shortcut', () => {
    makeEditor();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA, itemB])); // B has shortcut

    const buttons = Array.from(host?.querySelectorAll<HTMLButtonElement>('.dm-slash-command-item') ?? []);
    expect(buttons[0]?.querySelector('.dm-slash-command-item-shortcut')).toBeNull();
    expect(buttons[1]?.querySelector('.dm-slash-command-item-shortcut')?.textContent).toBe('Ctrl+Shift+8');
    renderer.onExit();
  });

  it('first item has data-selected attribute (default highlight)', () => {
    makeEditor();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA, itemB]));

    const buttons = Array.from(host?.querySelectorAll<HTMLButtonElement>('.dm-slash-command-item') ?? []);
    expect(buttons[0]?.hasAttribute('data-selected')).toBe(true);
    expect(buttons[1]?.hasAttribute('data-selected')).toBe(false);
    renderer.onExit();
  });

  it('root has aria-activedescendant pointing to selected button id', () => {
    makeEditor();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA]));

    const root = host?.querySelector('.dm-slash-command-menu');
    const selected = host?.querySelector('[data-selected]');
    expect(root?.getAttribute('aria-activedescendant')).toBe(selected?.id);
    renderer.onExit();
  });
});

describe('createSlashSuggestionRenderer - keyboard navigation', () => {
  it('ArrowDown advances selection and wraps at end', () => {
    makeEditor();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA, itemB]));

    expect(renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))).toBe(true);
    let buttons = Array.from(host?.querySelectorAll<HTMLButtonElement>('.dm-slash-command-item') ?? []);
    expect(buttons[1]?.hasAttribute('data-selected')).toBe(true);

    // Wrap at end
    renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    buttons = Array.from(host?.querySelectorAll<HTMLButtonElement>('.dm-slash-command-item') ?? []);
    expect(buttons[0]?.hasAttribute('data-selected')).toBe(true);
    renderer.onExit();
  });

  it('ArrowUp wraps at start', () => {
    makeEditor();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA, itemB]));

    expect(renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp' }))).toBe(true);
    const buttons = Array.from(host?.querySelectorAll<HTMLButtonElement>('.dm-slash-command-item') ?? []);
    expect(buttons[1]?.hasAttribute('data-selected')).toBe(true);
    renderer.onExit();
  });

  it('Home jumps to first item', () => {
    makeEditor();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA, itemB, itemC]));
    renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' })); // → 1
    renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'Home' })); // → 0
    const buttons = Array.from(host?.querySelectorAll<HTMLButtonElement>('.dm-slash-command-item') ?? []);
    expect(buttons[0]?.hasAttribute('data-selected')).toBe(true);
    renderer.onExit();
  });

  it('End jumps to last item', () => {
    makeEditor();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA, itemB, itemC]));
    renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'End' }));
    const buttons = Array.from(host?.querySelectorAll<HTMLButtonElement>('.dm-slash-command-item') ?? []);
    expect(buttons[2]?.hasAttribute('data-selected')).toBe(true);
    renderer.onExit();
  });

  it('Enter executes the currently-selected command', () => {
    makeEditor();
    const command = vi.fn();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA, itemB], command));
    renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' })); // selects B
    renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(command).toHaveBeenCalledWith(itemB);
    renderer.onExit();
  });

  it('Tab also executes the selected command', () => {
    makeEditor();
    const command = vi.fn();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA], command));
    renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(command).toHaveBeenCalledWith(itemA);
    renderer.onExit();
  });

  it('returns false for unhandled keys (lets PM keymap process them)', () => {
    makeEditor();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA]));
    expect(renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'a' }))).toBe(false);
    expect(renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'Backspace' }))).toBe(false);
    renderer.onExit();
  });

  it('returns false when no items are rendered', () => {
    makeEditor();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([]));
    expect(renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))).toBe(false);
    renderer.onExit();
  });

  it('returns false before onStart (no root)', () => {
    const renderer = createSlashSuggestionRenderer();
    expect(renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))).toBe(false);
  });
});

describe('createSlashSuggestionRenderer - mouse interaction', () => {
  it('mouseenter on a button selects that item', () => {
    makeEditor();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA, itemB]));

    const buttons = Array.from(host?.querySelectorAll<HTMLButtonElement>('.dm-slash-command-item') ?? []);
    buttons[1]?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(buttons[1]?.hasAttribute('data-selected')).toBe(true);
    expect(buttons[0]?.hasAttribute('data-selected')).toBe(false);
    renderer.onExit();
  });

  it('click on a button executes the corresponding command', () => {
    makeEditor();
    const command = vi.fn();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA, itemB], command));

    const buttons = Array.from(host?.querySelectorAll<HTMLButtonElement>('.dm-slash-command-item') ?? []);
    buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(command).toHaveBeenCalledWith(itemB);
    renderer.onExit();
  });

  it('click after onExit is a no-op (destroyed flag)', () => {
    makeEditor();
    const command = vi.fn();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA], command));

    const btn = host?.querySelector<HTMLButtonElement>('.dm-slash-command-item');
    renderer.onExit();
    // After exit the button has been removed from DOM, but if we cached it,
    // dispatching click would invoke the listener. This guards against the
    // mousedown→onExit→click race documented in the source.
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(command).not.toHaveBeenCalled();
  });

  it('mousedown on a button is preventDefault to keep editor focus', () => {
    makeEditor();
    const renderer = createSlashSuggestionRenderer();
    renderer.onStart(makeProps([itemA]));

    const btn = host?.querySelector<HTMLButtonElement>('.dm-slash-command-item');
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    btn?.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    renderer.onExit();
  });
});
