/**
 * CharacterCount Extension
 *
 * Provides character and word counting with optional limits.
 * Access counts via editor.storage.characterCount.characters() and .words()
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Extension } from '../Extension.js';

export interface CharacterCountOptions {
  /**
   * Maximum number of characters allowed. Set to null for no limit.
   * @default null
   */
  limit: number | null;

  /**
   * Maximum number of words allowed. Set to null for no limit.
   * @default null
   */
  wordLimit: number | null;

  /**
   * How to count characters:
   * - 'textSize': Count text characters only
   * - 'nodeSize': Count ProseMirror node size (includes structural characters)
   * @default 'textSize'
   */
  mode: 'textSize' | 'nodeSize';
}

export interface CharacterCountStorage {
  /**
   * Get current character count.
   */
  characters: () => number;

  /**
   * Get current word count.
   */
  words: () => number;

  /**
   * Get percentage of limit used (0-100). Returns 0 if no limit.
   */
  percentage: () => number;

  /**
   * Get remaining characters before limit. Returns Infinity if no limit.
   */
  remaining: () => number;

  /**
   * Check if limit is exceeded.
   */
  isLimitExceeded: () => boolean;
}

export const characterCountPluginKey = new PluginKey('characterCount');

export const CharacterCount = Extension.create<
  CharacterCountOptions,
  CharacterCountStorage
>({
  name: 'characterCount',

  addOptions() {
    return {
      limit: null,
      wordLimit: null,
      mode: 'textSize',
    };
  },

  addStorage() {
    return {
      characters: () => 0,
      words: () => 0,
      percentage: () => 0,
      remaining: () => Infinity,
      isLimitExceeded: () => false,
    };
  },

  onCreate() {
    const getCharacters = (): number => {
      const doc = this.editor?.view?.state?.doc;
      if (!doc) return 0;

      if (this.options.mode === 'nodeSize') {
        return doc.nodeSize;
      }

      return doc.textContent.length;
    };

    const getWords = (): number => {
      const doc = this.editor?.view?.state?.doc;
      if (!doc) return 0;

      const text = doc.textContent;
      const words = text.split(/\s+/).filter((word) => word.length > 0);
      return words.length;
    };

    this.storage.characters = getCharacters;
    this.storage.words = getWords;

    this.storage.percentage = () => {
      if (this.options.limit === null) return 0;
      const chars = getCharacters();
      return Math.min(100, Math.round((chars / this.options.limit) * 100));
    };

    this.storage.remaining = () => {
      if (this.options.limit === null) return Infinity;
      return Math.max(0, this.options.limit - getCharacters());
    };

    this.storage.isLimitExceeded = () => {
      if (this.options.limit !== null) {
        if (getCharacters() > this.options.limit) return true;
      }
      if (this.options.wordLimit !== null) {
        if (getWords() > this.options.wordLimit) return true;
      }
      return false;
    };
  },

  addProseMirrorPlugins() {
    const { limit, wordLimit } = this.options;

    // If no limits, no need for filtering plugin
    if (limit === null && wordLimit === null) return [];

    return [
      new Plugin({
        key: characterCountPluginKey,
        filterTransaction: (transaction) => {
          // Allow non-document changes (selection, etc.)
          if (!transaction.docChanged) return true;

          const newDoc = transaction.doc;
          const text = newDoc.textContent;

          // Character limit check
          if (limit !== null && text.length > limit) {
            return false;
          }

          // Word limit check
          if (wordLimit !== null) {
            const words = text.split(/\s+/).filter((w) => w.length > 0);
            if (words.length > wordLimit) {
              return false;
            }
          }

          return true;
        },
      }),
    ];
  },
});
