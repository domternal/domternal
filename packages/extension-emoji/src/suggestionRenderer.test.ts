import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createEmojiSuggestionRenderer } from './suggestionRenderer.js';
import type { SuggestionProps } from './suggestionPlugin.js';
import type { EmojiItem } from './emojis.js';

function makeProps(overrides: Partial<SuggestionProps> = {}): SuggestionProps {
  const element = document.createElement('div');
  element.className = 'dm-editor';
  document.body.appendChild(element);

  const items: EmojiItem[] = [
    { emoji: '😀', name: 'grinning_face', shortcodes: ['grinning'], tags: ['face', 'happy'], group: 'Smileys' },
    { emoji: '😎', name: 'smiling_face_with_sunglasses', shortcodes: ['sunglasses'], tags: ['cool'], group: 'Smileys' },
    { emoji: '🎉', name: 'party_popper', shortcodes: ['tada'], tags: ['celebrate'], group: 'Activities' },
  ];

  return {
    items,
    query: '',
    command: vi.fn(),
    element,
    clientRect: () => new DOMRect(100, 100, 0, 0),
    ...overrides,
  } as SuggestionProps;
}

describe('createEmojiSuggestionRenderer', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    document.querySelectorAll('.dm-emoji-suggestion').forEach((el) => { el.remove(); });
    document.querySelectorAll('.dm-editor').forEach((el) => { el.remove(); });
  });

  it('returns a factory function', () => {
    const factory = createEmojiSuggestionRenderer();
    expect(typeof factory).toBe('function');
  });

  it('factory returns a renderer with lifecycle hooks', () => {
    const renderer = createEmojiSuggestionRenderer()();
    expect(typeof renderer.onStart).toBe('function');
    expect(typeof renderer.onUpdate).toBe('function');
    expect(typeof renderer.onExit).toBe('function');
    expect(typeof renderer.onKeyDown).toBe('function');
  });

  describe('onStart', () => {
    it('creates container with suggestion class', () => {
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps());

      const container = document.querySelector('.dm-emoji-suggestion');
      expect(container).not.toBeNull();
      expect(container?.getAttribute('role')).toBe('listbox');
      expect(container?.getAttribute('aria-label')).toBe('Emoji suggestions');

      renderer.onExit();
    });

    it('renders items with emoji and name', () => {
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps());

      const items = document.querySelectorAll('.dm-emoji-suggestion-item');
      expect(items.length).toBe(3);
      const firstEmoji = items[0]?.querySelector('.dm-emoji-suggestion-emoji');
      const firstName = items[0]?.querySelector('.dm-emoji-suggestion-name');
      expect(firstEmoji?.textContent).toBe('😀');
      expect(firstName?.textContent).toBe('grinning face'); // underscores replaced

      renderer.onExit();
    });

    it('marks first item as selected initially', () => {
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps());

      const selected = document.querySelector('.dm-emoji-suggestion-item--selected');
      expect(selected).not.toBeNull();
      expect(selected?.getAttribute('aria-selected')).toBe('true');

      renderer.onExit();
    });

    it('renders "No emoji found" when items array is empty', () => {
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps({ items: [] }));

      const empty = document.querySelector('.dm-emoji-suggestion-empty');
      expect(empty).not.toBeNull();
      expect(empty?.textContent).toBe('No emoji found');

      renderer.onExit();
    });

    it('limits items to MAX_ITEMS (10)', () => {
      const manyItems: EmojiItem[] = Array.from({ length: 20 }, (_, i) => ({
        emoji: '🙂',
        name: `emoji_${String(i)}`,
        shortcodes: [`e${String(i)}`],
        tags: [],
        group: 'Smileys',
      }));
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps({ items: manyItems }));

      const items = document.querySelectorAll('.dm-emoji-suggestion-item');
      expect(items.length).toBe(10);

      renderer.onExit();
    });

    it('appends to .dm-editor ancestor when present', () => {
      const editorEl = document.createElement('div');
      editorEl.className = 'dm-editor';
      host.appendChild(editorEl);
      const innerEl = document.createElement('div');
      editorEl.appendChild(innerEl);

      const renderer = createEmojiSuggestionRenderer()();
      const props = makeProps();
      (props as any).element = innerEl;
      renderer.onStart(props);

      expect(editorEl.querySelector('.dm-emoji-suggestion')).not.toBeNull();

      renderer.onExit();
    });

    it('appends to document.body when no .dm-editor ancestor', () => {
      const orphan = document.createElement('div');
      document.body.appendChild(orphan);

      const renderer = createEmojiSuggestionRenderer()();
      const props = makeProps();
      (props as any).element = orphan;
      renderer.onStart(props);

      expect(document.body.querySelector('.dm-emoji-suggestion')).not.toBeNull();

      renderer.onExit();
      orphan.remove();
    });
  });

  describe('onUpdate', () => {
    it('re-renders with new items', () => {
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps());
      expect(document.querySelectorAll('.dm-emoji-suggestion-item').length).toBe(3);

      renderer.onUpdate(makeProps({
        items: [
          { emoji: '❤️', name: 'red_heart', shortcodes: ['heart'], tags: ['love'], group: 'Symbols' },
          { emoji: '🔥', name: 'fire', shortcodes: ['fire'], tags: ['hot'], group: 'Nature' },
        ],
      }));

      const items = document.querySelectorAll('.dm-emoji-suggestion-item');
      expect(items.length).toBe(2);

      renderer.onExit();
    });

    it('resets selectedIndex to 0 on update', () => {
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps());

      renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

      renderer.onUpdate(makeProps());

      const items = document.querySelectorAll('.dm-emoji-suggestion-item');
      expect(items[0]?.classList.contains('dm-emoji-suggestion-item--selected')).toBe(true);

      renderer.onExit();
    });
  });

  describe('onExit', () => {
    it('removes container from DOM', () => {
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps());
      expect(document.querySelector('.dm-emoji-suggestion')).not.toBeNull();

      renderer.onExit();
      expect(document.querySelector('.dm-emoji-suggestion')).toBeNull();
    });

    it('can be called multiple times safely', () => {
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps());
      renderer.onExit();
      expect(() => { renderer.onExit(); }).not.toThrow();
    });
  });

  describe('onKeyDown', () => {
    it('returns false when never started', () => {
      const renderer = createEmojiSuggestionRenderer()();
      const result = renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(result).toBe(false);
    });

    it('ArrowDown advances selection', () => {
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps());

      const result = renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      expect(result).toBe(true);

      const items = document.querySelectorAll('.dm-emoji-suggestion-item');
      expect(items[1]?.classList.contains('dm-emoji-suggestion-item--selected')).toBe(true);

      renderer.onExit();
    });

    it('ArrowDown clamps at last item', () => {
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps());

      for (let i = 0; i < 10; i++) {
        renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      }

      const items = document.querySelectorAll('.dm-emoji-suggestion-item');
      expect(items[2]?.classList.contains('dm-emoji-suggestion-item--selected')).toBe(true);

      renderer.onExit();
    });

    it('ArrowUp moves selection back', () => {
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps());

      renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

      const items = document.querySelectorAll('.dm-emoji-suggestion-item');
      expect(items[0]?.classList.contains('dm-emoji-suggestion-item--selected')).toBe(true);

      renderer.onExit();
    });

    it('ArrowUp clamps at 0', () => {
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps());

      for (let i = 0; i < 10; i++) {
        renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      }

      const items = document.querySelectorAll('.dm-emoji-suggestion-item');
      expect(items[0]?.classList.contains('dm-emoji-suggestion-item--selected')).toBe(true);

      renderer.onExit();
    });

    it('Enter calls command with selected item', () => {
      const command = vi.fn();
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps({ command }));

      renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(command).toHaveBeenCalledTimes(1);
      expect((command.mock.calls[0] as unknown[])[0]).toMatchObject({ emoji: '😀' });

      renderer.onExit();
    });

    it('Enter with no items does not throw', () => {
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps({ items: [] }));

      expect(() => {
        renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
      }).not.toThrow();

      renderer.onExit();
    });

    it('returns false for other keys', () => {
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps());

      const result = renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(result).toBe(false);

      renderer.onExit();
    });
  });

  describe('item interactions', () => {
    it('clicking an item invokes command with that item', () => {
      const command = vi.fn();
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps({ command }));

      const items = document.querySelectorAll('.dm-emoji-suggestion-item');
      (items[1] as HTMLButtonElement).click();

      expect(command).toHaveBeenCalledTimes(1);
      expect((command.mock.calls[0] as unknown[])[0]).toMatchObject({ emoji: '😎' });

      renderer.onExit();
    });

    it('mousedown on item preventsDefault (avoid editor blur)', () => {
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps());

      const item = document.querySelector('.dm-emoji-suggestion-item')!;
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      item.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);

      renderer.onExit();
    });

    it('mouseenter on item updates selection', () => {
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps());

      const items = document.querySelectorAll('.dm-emoji-suggestion-item');
      const event = new MouseEvent('mouseenter', { bubbles: true });
      items[2]!.dispatchEvent(event);

      expect(items[2]?.classList.contains('dm-emoji-suggestion-item--selected')).toBe(true);

      renderer.onExit();
    });

    it('mouseenter on already-selected item does nothing extra', () => {
      const renderer = createEmojiSuggestionRenderer()();
      renderer.onStart(makeProps());

      const items = document.querySelectorAll('.dm-emoji-suggestion-item');
      const event = new MouseEvent('mouseenter', { bubbles: true });
      items[0]!.dispatchEvent(event);

      const selected = document.querySelectorAll('.dm-emoji-suggestion-item--selected');
      expect(selected.length).toBe(1);

      renderer.onExit();
    });
  });

  describe('updatePosition (via clientRect)', () => {
    it('handles clientRect returning null gracefully', () => {
      const renderer = createEmojiSuggestionRenderer()();
      const props = makeProps();
      (props as any).clientRect = () => null;

      expect(() => { renderer.onStart(props); }).not.toThrow();
      renderer.onExit();
    });
  });
});
