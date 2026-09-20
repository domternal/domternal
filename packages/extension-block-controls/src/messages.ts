import { defineMessage } from '@domternal/core';

declare module '@domternal/core' {
  interface MessageParameters {
    'blockControls.handle.drag': undefined;
    'blockControls.handle.add': undefined;
    'blockControls.context.label': undefined;
    'blockControls.context.delete': undefined;
    'blockControls.context.duplicate': undefined;
    'blockControls.context.copyLink': undefined;
    'blockControls.context.colors': undefined;
    'blockControls.context.turnInto': undefined;
    'blockControls.color.text': undefined;
    'blockControls.color.background': undefined;
    'blockControls.color.clearBackground': undefined;
    'blockControls.color.clearText': undefined;
    'blockControls.turnInto.paragraph': undefined;
    'blockControls.turnInto.bulletList': undefined;
    'blockControls.turnInto.orderedList': undefined;
    'blockControls.turnInto.taskList': undefined;
    'blockControls.turnInto.quote': undefined;
    'blockControls.turnInto.codeBlock': undefined;
    'blockControls.slash.noMatches': undefined;
    'blockControls.turnInto.heading': { level: number };
    'blockControls.color.backgroundSwatch': { color: string };
    'blockControls.color.textSwatch': { color: string };
  }
}

/** English UI definitions owned by the block controls package. */
export const blockControlsMessages = {
  dragHandle: defineMessage({
    id: 'blockControls.handle.drag', defaultValue: 'Drag to reorder, click for options', owner: '@domternal/extension-block-controls',
    description: 'Block controls UI: Drag to reorder, click for options.',
  }),
  addBlock: defineMessage({
    id: 'blockControls.handle.add', defaultValue: 'Add block below', owner: '@domternal/extension-block-controls',
    description: 'Block controls UI: Add block below.',
  }),
  contextMenu: defineMessage({
    id: 'blockControls.context.label', defaultValue: 'Block options', owner: '@domternal/extension-block-controls',
    description: 'Block controls UI: Block options.',
  }),
  delete: defineMessage({
    id: 'blockControls.context.delete', defaultValue: 'Delete', owner: '@domternal/extension-block-controls',
    description: 'Block controls UI: Delete.',
  }),
  duplicate: defineMessage({
    id: 'blockControls.context.duplicate', defaultValue: 'Duplicate', owner: '@domternal/extension-block-controls',
    description: 'Block controls UI: Duplicate.',
  }),
  copyLink: defineMessage({
    id: 'blockControls.context.copyLink', defaultValue: 'Copy link', owner: '@domternal/extension-block-controls',
    description: 'Block controls UI: Copy link.',
  }),
  colors: defineMessage({
    id: 'blockControls.context.colors', defaultValue: 'Colors', owner: '@domternal/extension-block-controls',
    description: 'Block controls UI: Colors.',
  }),
  turnInto: defineMessage({
    id: 'blockControls.context.turnInto', defaultValue: 'Turn into', owner: '@domternal/extension-block-controls',
    description: 'Block controls UI: Turn into.',
  }),
  textColor: defineMessage({
    id: 'blockControls.color.text', defaultValue: 'Text color', owner: '@domternal/extension-block-controls',
    description: 'Block controls UI: Text color.',
  }),
  background: defineMessage({
    id: 'blockControls.color.background', defaultValue: 'Background', owner: '@domternal/extension-block-controls',
    description: 'Block controls UI: Background.',
  }),
  clearBackground: defineMessage({
    id: 'blockControls.color.clearBackground', defaultValue: 'No background', owner: '@domternal/extension-block-controls',
    description: 'Block controls UI: No background.',
  }),
  clearText: defineMessage({
    id: 'blockControls.color.clearText', defaultValue: 'Default text color', owner: '@domternal/extension-block-controls',
    description: 'Block controls UI: Default text color.',
  }),
  paragraph: defineMessage({
    id: 'blockControls.turnInto.paragraph', defaultValue: 'Paragraph', owner: '@domternal/extension-block-controls',
    description: 'Block controls UI: Paragraph.',
  }),
  bulletList: defineMessage({
    id: 'blockControls.turnInto.bulletList', defaultValue: 'Bullet list', owner: '@domternal/extension-block-controls',
    description: 'Block controls UI: Bullet list.',
  }),
  orderedList: defineMessage({
    id: 'blockControls.turnInto.orderedList', defaultValue: 'Ordered list', owner: '@domternal/extension-block-controls',
    description: 'Block controls UI: Ordered list.',
  }),
  taskList: defineMessage({
    id: 'blockControls.turnInto.taskList', defaultValue: 'To-do list', owner: '@domternal/extension-block-controls',
    description: 'Block controls UI: To-do list.',
  }),
  quote: defineMessage({
    id: 'blockControls.turnInto.quote', defaultValue: 'Quote', owner: '@domternal/extension-block-controls',
    description: 'Block controls UI: Quote.',
  }),
  codeBlock: defineMessage({
    id: 'blockControls.turnInto.codeBlock', defaultValue: 'Code block', owner: '@domternal/extension-block-controls',
    description: 'Block controls UI: Code block.',
  }),
  noMatches: defineMessage({
    id: 'blockControls.slash.noMatches', defaultValue: 'No matches', owner: '@domternal/extension-block-controls',
    description: 'Block controls UI: No matches.',
  }),
  heading: defineMessage({
    id: 'blockControls.turnInto.heading', defaultValue: ({ level }, context) => `Heading ${context.number(level)}`,
    owner: '@domternal/extension-block-controls', description: 'Heading conversion action with its level.',
  }),
  backgroundSwatch: defineMessage({
    id: 'blockControls.color.backgroundSwatch', defaultValue: ({ color }) => `Background: ${color}`,
    owner: '@domternal/extension-block-controls', description: 'Accessible name for a block background color swatch.',
  }),
  textSwatch: defineMessage({
    id: 'blockControls.color.textSwatch', defaultValue: ({ color }) => `Text color: ${color}`,
    owner: '@domternal/extension-block-controls', description: 'Accessible name for a block text color swatch.',
  }),
} as const;
