import { Fragment } from 'react';
import type { Editor } from '@domternal/core';
import { useCurrentEditor } from '../EditorContext.js';
import { useEmojiPicker, type EmojiPickerItem } from './useEmojiPicker.js';

const CATEGORY_ICONS: Record<string, string> = {
  'Smileys & Emotion': '\u{1F600}',
  'People & Body': '\u{1F44B}',
  'Animals & Nature': '\u{1F431}',
  'Food & Drink': '\u{1F355}',
  'Travel & Places': '\u{1F697}',
  'Activities': '\u{26BD}',
  'Objects': '\u{1F4A1}',
  'Symbols': '\u{1F523}',
  'Flags': '\u{1F3C1}',
};

function categoryIcon(cat: string): string {
  return CATEGORY_ICONS[cat] ?? cat.charAt(0);
}

function formatName(name: string): string {
  return name.replace(/_/g, ' ');
}

export interface DomternalEmojiPickerProps {
  /** The editor instance. If omitted, uses EditorProvider context. */
  editor?: Editor;
  /** Array of emoji items with emoji, name, and group. */
  emojis: EmojiPickerItem[];
}

export function DomternalEmojiPicker({ editor: editorProp, emojis }: DomternalEmojiPickerProps) {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = editorProp ?? contextEditor;

  const {
    isOpen,
    searchQuery,
    activeCategory,
    categoryNames,
    filteredEmojis,
    frequentlyUsed,
    pickerRef,
    selectEmoji,
    onSearch,
    scrollToCategory,
    onGridScroll,
    close,
    categories,
  } = useEmojiPicker(editor, emojis);

  if (!isOpen) return <div ref={pickerRef} className="dm-emoji-picker-host" />;

  return (
    <div ref={pickerRef} className="dm-emoji-picker-host">
      <div className="dm-emoji-picker">
        <div className="dm-emoji-picker-search">
          <input
            type="text"
            placeholder="Search emoji..."
            value={searchQuery}
            onChange={onSearch}
            onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
          />
        </div>

        <div className="dm-emoji-picker-tabs" role="tablist">
          {categoryNames.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`dm-emoji-picker-tab${activeCategory === cat ? ' dm-emoji-picker-tab--active' : ''}`}
              title={cat}
              aria-label={cat}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => scrollToCategory(cat)}
            >
              {categoryIcon(cat)}
            </button>
          ))}
        </div>

        <div className="dm-emoji-picker-grid" onScroll={onGridScroll}>
          {searchQuery ? (
            <>
              {filteredEmojis.length > 0 ? (
                filteredEmojis.map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    className="dm-emoji-swatch"
                    title={formatName(item.name)}
                    aria-label={formatName(item.name)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectEmoji(item)}
                  >
                    {item.emoji}
                  </button>
                ))
              ) : (
                <div className="dm-emoji-picker-empty">No emoji found</div>
              )}
            </>
          ) : (
            <>
              {frequentlyUsed.length > 0 && (
                <>
                  <div className="dm-emoji-picker-category-label">Frequently Used</div>
                  {frequentlyUsed.map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      className="dm-emoji-swatch"
                      title={formatName(item.name)}
                      aria-label={formatName(item.name)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectEmoji(item)}
                    >
                      {item.emoji}
                    </button>
                  ))}
                </>
              )}
              {categoryNames.map((cat) => (
                <Fragment key={cat}>
                  <div className="dm-emoji-picker-category-label" data-category={cat}>
                    {cat}
                  </div>
                  {(categories.get(cat) ?? []).map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      className="dm-emoji-swatch"
                      title={formatName(item.name)}
                      aria-label={formatName(item.name)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectEmoji(item)}
                    >
                      {item.emoji}
                    </button>
                  ))}
                </Fragment>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
