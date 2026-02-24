/**
 * @domternal/extension-emoji
 *
 * Emoji extension for Domternal editor — inline emoji nodes with
 * shortcode input rules, emoticon support, and headless suggestion plugin.
 */

// Main extension
export { Emoji } from './Emoji.js';
export type { EmojiOptions, EmojiStorage } from './Emoji.js';

// Emoji data
export { emojis, allEmojis } from './emojis.js';
export type { EmojiItem } from './emojis.js';

// Emoticon mappings
export { emoticons } from './emoticons.js';

// Suggestion plugin
export { createSuggestionPlugin, emojiSuggestionPluginKey } from './suggestionPlugin.js';
export type {
  SuggestionOptions,
  SuggestionProps,
  SuggestionRenderer,
} from './suggestionPlugin.js';

// Default suggestion renderer (vanilla DOM)
export { createEmojiSuggestionRenderer } from './suggestionRenderer.js';

// Default export for convenience
export { Emoji as default } from './Emoji.js';
