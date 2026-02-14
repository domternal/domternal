// Mention extension
export { Mention } from './Mention.js';
export type { MentionOptions, MentionStorage } from './Mention.js';

// Mention suggestion plugin
export { createMentionSuggestionPlugin, dismissMentionSuggestion } from './mentionSuggestionPlugin.js';
export type {
  MentionItem,
  MentionTrigger,
  MentionSuggestionProps,
  MentionSuggestionRenderer,
} from './mentionSuggestionPlugin.js';

// Default export for convenience
export { Mention as default } from './Mention.js';
