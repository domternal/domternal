import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createMentionSuggestionRenderer } from './mentionSuggestionRenderer.js';
import type { MentionItem, MentionSuggestionProps } from './mentionSuggestionPlugin.js';

function makeProps(overrides: Partial<MentionSuggestionProps> = {}): MentionSuggestionProps {
  const element = document.createElement('div');
  element.className = 'dm-editor';
  document.body.appendChild(element);

  const items: MentionItem[] = [
    { id: '1', label: 'Alice' },
    { id: '2', label: 'Bob' },
    { id: '3', label: 'Charlie' },
  ];

  return {
    items,
    query: '',
    command: vi.fn(),
    element,
    clientRect: () => new DOMRect(100, 100, 0, 0),
    ...overrides,
  } as MentionSuggestionProps;
}

describe('createMentionSuggestionRenderer', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    document.querySelectorAll('.dm-mention-suggestion').forEach((el) => { el.remove(); });
    document.querySelectorAll('.dm-editor').forEach((el) => { el.remove(); });
  });

  it('returns a factory function', () => {
    const factory = createMentionSuggestionRenderer();
    expect(typeof factory).toBe('function');
  });

  it('factory returns a renderer with lifecycle hooks', () => {
    const factory = createMentionSuggestionRenderer();
    const renderer = factory();
    expect(typeof renderer.onStart).toBe('function');
    expect(typeof renderer.onUpdate).toBe('function');
    expect(typeof renderer.onExit).toBe('function');
    expect(typeof renderer.onKeyDown).toBe('function');
  });

  describe('onStart', () => {
    it('creates container with suggestion class', () => {
      const renderer = createMentionSuggestionRenderer()();
      const props = makeProps();
      renderer.onStart(props);

      const container = document.querySelector('.dm-mention-suggestion');
      expect(container).not.toBeNull();
      expect(container?.getAttribute('role')).toBe('listbox');
      expect(container?.getAttribute('aria-label')).toBe('Mention suggestions');

      renderer.onExit();
    });

    it('renders items as buttons', () => {
      const renderer = createMentionSuggestionRenderer()();
      renderer.onStart(makeProps());

      const items = document.querySelectorAll('.dm-mention-suggestion-item');
      expect(items.length).toBe(3);
      expect(items[0]?.textContent).toBe('Alice');

      renderer.onExit();
    });

    it('marks first item as selected initially', () => {
      const renderer = createMentionSuggestionRenderer()();
      renderer.onStart(makeProps());

      const selected = document.querySelector('.dm-mention-suggestion-item--selected');
      expect(selected).not.toBeNull();
      expect(selected?.textContent).toBe('Alice');
      expect(selected?.getAttribute('aria-selected')).toBe('true');

      renderer.onExit();
    });

    it('renders "No results" when items array is empty', () => {
      const renderer = createMentionSuggestionRenderer()();
      renderer.onStart(makeProps({ items: [] }));

      const empty = document.querySelector('.dm-mention-suggestion-empty');
      expect(empty).not.toBeNull();
      expect(empty?.textContent).toBe('No results');

      renderer.onExit();
    });

    it('limits items to MAX_ITEMS (8)', () => {
      const manyItems: MentionItem[] = Array.from({ length: 15 }, (_, i) => ({
        id: String(i),
        label: `User ${String(i)}`,
      }));
      const renderer = createMentionSuggestionRenderer()();
      renderer.onStart(makeProps({ items: manyItems }));

      const items = document.querySelectorAll('.dm-mention-suggestion-item');
      expect(items.length).toBe(8);

      renderer.onExit();
    });

    it('appends to .dm-editor ancestor when present', () => {
      const editorEl = document.createElement('div');
      editorEl.className = 'dm-editor';
      host.appendChild(editorEl);

      const innerEl = document.createElement('div');
      editorEl.appendChild(innerEl);

      const renderer = createMentionSuggestionRenderer()();
      const props = makeProps();
      (props as any).element = innerEl;
      renderer.onStart(props);

      const container = editorEl.querySelector('.dm-mention-suggestion');
      expect(container).not.toBeNull();

      renderer.onExit();
    });

    it('appends to document.body when no .dm-editor ancestor', () => {
      const orphan = document.createElement('div');
      // Not attached to any .dm-editor
      document.body.appendChild(orphan);

      const renderer = createMentionSuggestionRenderer()();
      const props = makeProps();
      (props as any).element = orphan;
      renderer.onStart(props);

      // Container is appended to body
      expect(document.body.querySelector('.dm-mention-suggestion')).not.toBeNull();

      renderer.onExit();
      orphan.remove();
    });
  });

  describe('onUpdate', () => {
    it('re-renders with new items', () => {
      const renderer = createMentionSuggestionRenderer()();
      renderer.onStart(makeProps());
      expect(document.querySelectorAll('.dm-mention-suggestion-item').length).toBe(3);

      renderer.onUpdate(makeProps({
        items: [
          { id: '10', label: 'Diana' },
          { id: '11', label: 'Eve' },
        ],
      }));

      const items = document.querySelectorAll('.dm-mention-suggestion-item');
      expect(items.length).toBe(2);
      expect(items[0]?.textContent).toBe('Diana');

      renderer.onExit();
    });

    it('resets selectedIndex to 0 on update', () => {
      const renderer = createMentionSuggestionRenderer()();
      renderer.onStart(makeProps());

      // Navigate down
      renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

      // Update - should reset selection to first item
      renderer.onUpdate(makeProps());

      const selected = document.querySelector('.dm-mention-suggestion-item--selected');
      expect(selected?.textContent).toBe('Alice');

      renderer.onExit();
    });
  });

  describe('onExit', () => {
    it('removes container from DOM', () => {
      const renderer = createMentionSuggestionRenderer()();
      renderer.onStart(makeProps());
      expect(document.querySelector('.dm-mention-suggestion')).not.toBeNull();

      renderer.onExit();
      expect(document.querySelector('.dm-mention-suggestion')).toBeNull();
    });

    it('can be called multiple times safely', () => {
      const renderer = createMentionSuggestionRenderer()();
      renderer.onStart(makeProps());
      renderer.onExit();
      expect(() => { renderer.onExit(); }).not.toThrow();
    });
  });

  describe('onKeyDown', () => {
    it('returns false when no props set (never started)', () => {
      const renderer = createMentionSuggestionRenderer()();
      const result = renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(result).toBe(false);
    });

    it('ArrowDown advances selection', () => {
      const renderer = createMentionSuggestionRenderer()();
      renderer.onStart(makeProps());

      const result = renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      expect(result).toBe(true);

      const selected = document.querySelector('.dm-mention-suggestion-item--selected');
      expect(selected?.textContent).toBe('Bob');

      renderer.onExit();
    });

    it('ArrowDown clamps at last item', () => {
      const renderer = createMentionSuggestionRenderer()();
      renderer.onStart(makeProps());

      // 3 items, press ArrowDown many times
      for (let i = 0; i < 10; i++) {
        renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      }

      const selected = document.querySelector('.dm-mention-suggestion-item--selected');
      expect(selected?.textContent).toBe('Charlie'); // last item

      renderer.onExit();
    });

    it('ArrowUp moves selection back', () => {
      const renderer = createMentionSuggestionRenderer()();
      renderer.onStart(makeProps());

      renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

      const selected = document.querySelector('.dm-mention-suggestion-item--selected');
      expect(selected?.textContent).toBe('Alice');

      renderer.onExit();
    });

    it('ArrowUp clamps at 0', () => {
      const renderer = createMentionSuggestionRenderer()();
      renderer.onStart(makeProps());

      for (let i = 0; i < 10; i++) {
        renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      }

      const selected = document.querySelector('.dm-mention-suggestion-item--selected');
      expect(selected?.textContent).toBe('Alice');

      renderer.onExit();
    });

    it('Enter calls command with selected item', () => {
      const command = vi.fn();
      const renderer = createMentionSuggestionRenderer()();
      renderer.onStart(makeProps({ command }));

      renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(command).toHaveBeenCalledTimes(1);
      expect(command).toHaveBeenCalledWith({ id: '1', label: 'Alice' });

      renderer.onExit();
    });

    it('Enter with no items does not throw', () => {
      const renderer = createMentionSuggestionRenderer()();
      renderer.onStart(makeProps({ items: [] }));

      expect(() => {
        renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
      }).not.toThrow();

      renderer.onExit();
    });

    it('returns false for other keys', () => {
      const renderer = createMentionSuggestionRenderer()();
      renderer.onStart(makeProps());

      const result = renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(result).toBe(false);

      renderer.onExit();
    });
  });

  describe('item interactions', () => {
    it('clicking an item invokes command with that item', () => {
      const command = vi.fn();
      const renderer = createMentionSuggestionRenderer()();
      renderer.onStart(makeProps({ command }));

      const items = document.querySelectorAll('.dm-mention-suggestion-item');
      (items[1] as HTMLButtonElement).click();

      expect(command).toHaveBeenCalledWith({ id: '2', label: 'Bob' });

      renderer.onExit();
    });

    it('mousedown on item preventsDefault (avoid editor blur)', () => {
      const renderer = createMentionSuggestionRenderer()();
      renderer.onStart(makeProps());

      const item = document.querySelector('.dm-mention-suggestion-item')!;
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      item.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);

      renderer.onExit();
    });

    it('mouseenter on item updates selection', () => {
      const renderer = createMentionSuggestionRenderer()();
      renderer.onStart(makeProps());

      const items = document.querySelectorAll('.dm-mention-suggestion-item');
      const event = new MouseEvent('mouseenter', { bubbles: true });
      items[2]!.dispatchEvent(event);

      const selected = document.querySelector('.dm-mention-suggestion-item--selected');
      expect(selected?.textContent).toBe('Charlie');

      renderer.onExit();
    });

    it('mouseenter on already-selected item does nothing extra', () => {
      const renderer = createMentionSuggestionRenderer()();
      renderer.onStart(makeProps());

      const items = document.querySelectorAll('.dm-mention-suggestion-item');
      // First item is already selected
      const event = new MouseEvent('mouseenter', { bubbles: true });
      items[0]!.dispatchEvent(event);

      const selected = document.querySelectorAll('.dm-mention-suggestion-item--selected');
      expect(selected.length).toBe(1);

      renderer.onExit();
    });
  });

  describe('updatePosition (via clientRect)', () => {
    it('handles clientRect returning null gracefully', () => {
      const renderer = createMentionSuggestionRenderer()();
      const props = makeProps();
      (props as any).clientRect = () => null;

      expect(() => { renderer.onStart(props); }).not.toThrow();
      renderer.onExit();
    });

    it('reads position from clientRect on update', () => {
      const renderer = createMentionSuggestionRenderer()();
      let rect = new DOMRect(100, 200, 0, 0);
      const props = makeProps();
      (props as any).clientRect = () => rect;

      renderer.onStart(props);

      // Change position and update
      rect = new DOMRect(300, 400, 0, 0);
      renderer.onUpdate(props);

      // Should not throw - position is updated via positionFloating
      expect(document.querySelector('.dm-mention-suggestion')).not.toBeNull();

      renderer.onExit();
    });
  });
});
