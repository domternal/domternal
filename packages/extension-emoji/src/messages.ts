import { defineMessage } from '@domternal/core';

declare module '@domternal/core' {
  interface MessageParameters {
    'emoji.insert': undefined;
    'emoji.suggestion.label': undefined;
    'emoji.suggestion.empty': undefined;
  }
}

/** Emoji extension UI does not change shortcode or document identities. */
export const emojiMessages = {
  insert: defineMessage({
    id: 'emoji.insert',
    defaultValue: 'Insert Emoji',
    owner: '@domternal/extension-emoji',
    description: 'Toolbar action that opens the emoji picker.',
  }),
  suggestionLabel: defineMessage({
    id: 'emoji.suggestion.label',
    defaultValue: 'Emoji suggestions',
    owner: '@domternal/extension-emoji',
    description: 'Accessible name of emoji autocomplete results.',
  }),
  suggestionEmpty: defineMessage({
    id: 'emoji.suggestion.empty',
    defaultValue: 'No emoji found',
    owner: '@domternal/extension-emoji',
    description: 'Empty emoji autocomplete results.',
  }),
} as const;
