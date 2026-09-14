import { defineMessage } from '../i18n/index.js';
import { corePickerMessages } from './pickers.js';
import { coreActionMessages } from './actions.js';

declare module '@domternal/core' {
  interface MessageParameters {
    'core.colorPicker.text': undefined;
    'core.colorPicker.background': undefined;
    'core.colorPicker.defaultText': undefined;
    'core.colorPicker.defaultBackground': undefined;
    'core.emojiPicker.label': undefined;
    'core.emojiPicker.searchPlaceholder': undefined;
    'core.emojiPicker.searchLabel': undefined;
    'core.emojiPicker.empty': undefined;
    'core.emojiPicker.frequentlyUsed': undefined;
    'core.emojiPicker.categories': undefined;
    'core.colorPicker.gray': undefined;
    'core.colorPicker.brown': undefined;
    'core.colorPicker.orange': undefined;
    'core.colorPicker.yellow': undefined;
    'core.colorPicker.green': undefined;
    'core.colorPicker.blue': undefined;
    'core.colorPicker.purple': undefined;
    'core.colorPicker.pink': undefined;
    'core.colorPicker.red': undefined;
    'core.emojiPicker.category.smileysEmotion': undefined;
    'core.emojiPicker.category.peopleBody': undefined;
    'core.emojiPicker.category.animalsNature': undefined;
    'core.emojiPicker.category.foodDrink': undefined;
    'core.emojiPicker.category.travelPlaces': undefined;
    'core.emojiPicker.category.activities': undefined;
    'core.emojiPicker.category.objects': undefined;
    'core.emojiPicker.category.symbols': undefined;
    'core.emojiPicker.category.flags': undefined;
    'core.colorPicker.textSwatch': { color: string };
    'core.colorPicker.backgroundSwatch': { color: string };
    'core.emojiPicker.itemName': { name: string };
    'core.toolbar.italic': undefined;
    'core.toolbar.underline': undefined;
    'core.toolbar.strike': undefined;
    'core.toolbar.code': undefined;
    'core.toolbar.subscript': undefined;
    'core.toolbar.superscript': undefined;
    'core.toolbar.link': undefined;
    'core.toolbar.hardBreak': undefined;
    'core.toolbar.blockquote': undefined;
    'core.floating.quote': undefined;
    'core.floating.quoteDescription': undefined;
    'core.toolbar.horizontalRule': undefined;
    'core.floating.divider': undefined;
    'core.floating.dividerDescription': undefined;
    'core.toolbar.bulletList': undefined;
    'core.floating.bulletedList': undefined;
    'core.floating.bulletedListDescription': undefined;
    'core.toolbar.orderedList': undefined;
    'core.floating.numberedList': undefined;
    'core.floating.numberedListDescription': undefined;
    'core.toolbar.taskList': undefined;
    'core.floating.todoList': undefined;
    'core.floating.todoListDescription': undefined;
    'core.toolbar.codeBlock': undefined;
    'core.floating.codeBlock': undefined;
    'core.floating.codeBlockDescription': undefined;
    'core.toolbar.heading': undefined;
    'core.toolbar.normalText': undefined;
    'core.floating.headingBigDescription': undefined;
    'core.floating.headingMediumDescription': undefined;
    'core.floating.headingSmallDescription': undefined;
    'core.floating.headingDescription': undefined;
    'core.toolbar.fontFamily': undefined;
    'core.toolbar.fontSize': undefined;
    'core.toolbar.fontSizeDefault': undefined;
    'core.toolbar.lineHeight': undefined;
    'core.toolbar.lineHeightDefault': undefined;
    'core.toolbar.print': undefined;
    'core.toolbar.textColor': undefined;
    'core.toolbar.textColorDefault': undefined;
    'core.toolbar.highlight': undefined;
    'core.toolbar.noHighlight': undefined;
    'core.toolbar.textAlignment': undefined;
    'core.toolbar.alignLeft': undefined;
    'core.toolbar.alignCenter': undefined;
    'core.toolbar.alignRight': undefined;
    'core.toolbar.justify': undefined;
    'core.toolbar.invisibleCharacters': undefined;
    'core.toolbar.clearFormatting': undefined;
    'core.toolbar.undo': undefined;
    'core.toolbar.redo': undefined;
    'core.colorPicker.label': undefined;
    'core.placeholder.default': undefined;
    'core.linkPopover.urlPlaceholder': undefined;
    'core.linkPopover.urlLabel': undefined;
    'core.linkPopover.apply': undefined;
    'core.linkPopover.remove': undefined;
    'core.taskItem.status': undefined;
    'core.group.format': undefined;
    'core.group.blocks': undefined;
    'core.group.lists': undefined;
    'core.group.textStyle': undefined;
    'core.group.alignment': undefined;
    'core.group.history': undefined;
    'core.group.document': undefined;
    'core.group.utilities': undefined;
    'core.group.utility': undefined;
    'core.group.insert': undefined;
    'core.group.basic': undefined;
    'core.group.listInsert': undefined;
    'core.heading.level': { level: number };
    'core.group.media': undefined;
    'core.editor.label': undefined;
    'core.toolbar.bold': undefined;
    'core.toolbar.label': undefined;
    'core.bubbleMenu.label': undefined;
    'core.bubbleMenu.moreOptions': undefined;
    'core.bubbleMenu.blockActionsSelectionHint': undefined;
    'core.floatingMenu.label': undefined;
    'core.toolbar.toolsGroup': undefined;
  }
  interface SearchableMessages {
    'core.floating.quote': true;
    'core.floating.divider': true;
    'core.floating.bulletedList': true;
    'core.floating.numberedList': true;
    'core.floating.todoList': true;
    'core.floating.codeBlock': true;
    'core.heading.level': true;
    'core.toolbar.bold': true;
  }
}

/** English definitions stay with their owning package and contain no editor state. */
export const coreMessages = {
  ...coreActionMessages,
  ...corePickerMessages,
  groupMedia: defineMessage({
    id: 'core.group.media',
    defaultValue: 'Media',
    owner: '@domternal/core',
    description: 'Media insertion group name.',
  }),
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
  moreOptions: defineMessage({
    id: 'core.bubbleMenu.moreOptions',
    defaultValue: 'More options',
    owner: '@domternal/core',
    description: 'Accessible name for additional block actions.',
  }),
  blockActionsSelectionHint: defineMessage({
    id: 'core.bubbleMenu.blockActionsSelectionHint',
    defaultValue: 'Block actions (select within a single block)',
    owner: '@domternal/core',
    description: 'Explains why block actions require a selection within one block.',
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
