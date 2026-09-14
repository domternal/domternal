import { defineMessage } from '../i18n/index.js';
import { coreActionMessages } from './actions.js';

declare module '@domternal/core' {
  interface MessageParameters {
    'core.editor.label': undefined;
    'core.toolbar.bold': undefined;
    'core.toolbar.label': undefined;
    'core.bubbleMenu.label': undefined;
    'core.floatingMenu.label': undefined;
    'core.toolbar.toolsGroup': undefined;
  }
  interface SearchableMessages {
    'core.toolbar.bold': true;
  }
}

/** English definitions stay with their owning package and contain no editor state. */
export const coreMessages = {
  ...coreActionMessages,
  toolbarLabel: defineMessage({
    id: 'core.toolbar.label',
    defaultValue: 'Editor formatting',
    owner: '@domternal/core',
    description: 'Accessible name of the editor toolbar.',
  }),
  bubbleMenuLabel: defineMessage({
    id: 'core.bubbleMenu.label',
    defaultValue: 'Text formatting',
    owner: '@domternal/core',
    description: 'Accessible name of the selection formatting menu.',
  }),
  floatingMenuLabel: defineMessage({
    id: 'core.floatingMenu.label',
    defaultValue: 'Insert block',
    owner: '@domternal/core',
    description: 'Accessible name of the block insertion menu.',
  }),
  toolsGroup: defineMessage({
    id: 'core.toolbar.toolsGroup',
    defaultValue: 'Tools',
    owner: '@domternal/core',
    description: 'Accessible fallback name for an unnamed toolbar group.',
  }),
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
