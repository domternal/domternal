import { defineMessage } from '@domternal/core';

declare module '@domternal/core' {
  interface MessageParameters {
    'mention.suggestions.label': undefined;
    'mention.suggestions.empty': undefined;
  }
}

/** English UI definitions owned by the mention package. */
export const mentionMessages = {
  suggestions: defineMessage({
    id: 'mention.suggestions.label', defaultValue: 'Mention suggestions', owner: '@domternal/extension-mention',
    description: 'Accessible name of the mention suggestions menu.',
  }),
  empty: defineMessage({
    id: 'mention.suggestions.empty', defaultValue: 'No results', owner: '@domternal/extension-mention',
    description: 'Empty state when a mention query returns no items.',
  }),
} as const;
