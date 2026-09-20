import { defineMessage } from '@domternal/core';

declare module '@domternal/core' {
  interface MessageParameters {
    'details.toggle.label': undefined;
    'details.toolbar.toggle': undefined;
    'details.insert.label': undefined;
    'details.insert.description': undefined;
  }
  interface SearchableMessages {
    'details.insert.label': true;
  }
}

/** English UI definitions owned by the details package. */
export const detailsMessages = {
  toggle: defineMessage({
    id: 'details.toggle.label', defaultValue: 'Toggle details', owner: '@domternal/extension-details',
    description: 'Accessible name of the button that expands or collapses details.',
  }),
  toolbar: defineMessage({
    id: 'details.toolbar.toggle', defaultValue: 'Toggle Details', owner: '@domternal/extension-details',
    description: 'Toolbar action that wraps or unwraps a details block.',
  }),
  insert: defineMessage({
    id: 'details.insert.label', defaultValue: 'Toggle block', owner: '@domternal/extension-details',
    description: 'Details block insertion action.', technicalAliases: ['toggle', 'collapse', 'details', 'accordion'],
  }),
  description: defineMessage({
    id: 'details.insert.description', defaultValue: 'Collapsible content area', owner: '@domternal/extension-details',
    description: 'Description of the details insertion action.', allowEmpty: true,
  }),
} as const;
