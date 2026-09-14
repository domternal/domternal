import { defineMessage } from '../i18n/index.js';

declare module '@domternal/core' {
  interface MessageParameters {
    'core.editor.label': undefined;
    'core.toolbar.bold': undefined;
  }
  interface SearchableMessages {
    'core.toolbar.bold': true;
  }
}

/** English definitions stay with their owning package and contain no editor state. */
export const coreMessages = {
  editorLabel: defineMessage({
    id: 'core.editor.label',
    defaultValue: 'Rich text editor',
    owner: '@domternal/core',
    description: 'Default accessible name for the editable document.',
  }),
  bold: defineMessage({
    id: 'core.toolbar.bold',
    defaultValue: 'Bold',
    owner: '@domternal/core',
    description: 'Accessible name and tooltip for the bold formatting action.',
    technicalAliases: ['bold'],
  }),
} as const;
