import { defineMessage, type MessageDefinition, type MessageId } from '../i18n/index.js';

declare module '@domternal/core' {
  interface MessageParameters {
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
  }
  interface SearchableMessages {
    'core.floating.quote': true;
    'core.floating.divider': true;
    'core.floating.bulletedList': true;
    'core.floating.numberedList': true;
    'core.floating.todoList': true;
    'core.floating.codeBlock': true;
    'core.heading.level': true;
  }
}

function message<const Id extends MessageId>(
  id: Id,
  defaultValue: string,
  description: string
): MessageDefinition<Id> {
  return defineMessage({ id, defaultValue, description, owner: '@domternal/core' });
}

/** Core actions preserve identifiers independently of their displayed wording. */
export const coreActionMessages = {
  italic: message('core.toolbar.italic', 'Italic', 'Italic formatting action.'),
  underline: message('core.toolbar.underline', 'Underline', 'Underline formatting action.'),
  strike: message('core.toolbar.strike', 'Strikethrough', 'Strikethrough formatting action.'),
  code: message('core.toolbar.code', 'Code', 'Inline code formatting action.'),
  subscript: message('core.toolbar.subscript', 'Subscript', 'Subscript formatting action.'),
  superscript: message('core.toolbar.superscript', 'Superscript', 'Superscript formatting action.'),
  link: message('core.toolbar.link', 'Link', 'Link formatting action.'),
  hardBreak: message('core.toolbar.hardBreak', 'Hard Break', 'Hard break insertion action.'),
  blockquote: message('core.toolbar.blockquote', 'Blockquote', 'Blockquote formatting action.'),
  quote: defineMessage({
    id: 'core.floating.quote',
    defaultValue: 'Quote',
    description: 'Quote insertion action.',
    owner: '@domternal/core',
    technicalAliases: ['quote', 'blockquote', 'citation'],
  }),
  quoteDescription: message(
    'core.floating.quoteDescription',
    'Capture a quote',
    'Description of quote insertion.'
  ),
  horizontalRule: message(
    'core.toolbar.horizontalRule',
    'Horizontal Rule',
    'Horizontal rule insertion action.'
  ),
  divider: defineMessage({
    id: 'core.floating.divider',
    defaultValue: 'Divider',
    description: 'Divider insertion action.',
    owner: '@domternal/core',
    technicalAliases: ['divider', 'hr', 'line', 'separator', 'horizontal rule'],
  }),
  dividerDescription: message(
    'core.floating.dividerDescription',
    'Insert a horizontal rule',
    'Description of divider insertion.'
  ),
  bulletList: message('core.toolbar.bulletList', 'Bullet List', 'Bullet list formatting action.'),
  bulletedList: defineMessage({
    id: 'core.floating.bulletedList',
    defaultValue: 'Bulleted list',
    description: 'Bulleted list insertion action.',
    owner: '@domternal/core',
    technicalAliases: ['bullet', 'list', 'unordered', 'ul'],
  }),
  bulletedListDescription: message(
    'core.floating.bulletedListDescription',
    'Create a simple bulleted list',
    'Description of bulleted list insertion.'
  ),
  orderedList: message(
    'core.toolbar.orderedList',
    'Ordered List',
    'Ordered list formatting action.'
  ),
  numberedList: defineMessage({
    id: 'core.floating.numberedList',
    defaultValue: 'Numbered list',
    description: 'Numbered list insertion action.',
    owner: '@domternal/core',
    technicalAliases: ['ordered', 'numbered', 'list', 'ol', '1.'],
  }),
  numberedListDescription: message(
    'core.floating.numberedListDescription',
    'Create a numbered list',
    'Description of numbered list insertion.'
  ),
  taskList: message('core.toolbar.taskList', 'Task List', 'Task list formatting action.'),
  todoList: defineMessage({
    id: 'core.floating.todoList',
    defaultValue: 'To-do list',
    description: 'Task list insertion action.',
    owner: '@domternal/core',
    technicalAliases: ['todo', 'task', 'checkbox', 'check'],
  }),
  todoListDescription: message(
    'core.floating.todoListDescription',
    'Track tasks with a checkbox list',
    'Description of task list insertion.'
  ),
  codeBlock: message('core.toolbar.codeBlock', 'Code Block', 'Code block formatting action.'),
  insertCodeBlock: defineMessage({
    id: 'core.floating.codeBlock',
    defaultValue: 'Code block',
    description: 'Code block insertion action.',
    owner: '@domternal/core',
    technicalAliases: ['code', 'snippet', 'pre'],
  }),
  codeBlockDescription: message(
    'core.floating.codeBlockDescription',
    'Capture a code snippet',
    'Description of code block insertion.'
  ),
  heading: message('core.toolbar.heading', 'Heading', 'Heading dropdown name.'),
  normalText: message('core.toolbar.normalText', 'Normal text', 'Paragraph formatting action.'),
  headingBigDescription: message(
    'core.floating.headingBigDescription',
    'Big section heading',
    'Description of a level one heading.'
  ),
  headingMediumDescription: message(
    'core.floating.headingMediumDescription',
    'Medium section heading',
    'Description of a level two heading.'
  ),
  headingSmallDescription: message(
    'core.floating.headingSmallDescription',
    'Small section heading',
    'Description of a level three heading.'
  ),
  headingDescription: message(
    'core.floating.headingDescription',
    'Section heading',
    'Description of another heading level.'
  ),
  fontFamily: message('core.toolbar.fontFamily', 'Font Family', 'Font family dropdown name.'),
  fontSize: message('core.toolbar.fontSize', 'Font Size', 'Font size dropdown name.'),
  fontSizeDefault: message('core.toolbar.fontSizeDefault', '–', 'Default font size option.'),
  lineHeight: message('core.toolbar.lineHeight', 'Line Height', 'Line height dropdown name.'),
  lineHeightDefault: message(
    'core.toolbar.lineHeightDefault',
    'Default',
    'Default line height option.'
  ),
  print: message('core.toolbar.print', 'Print', 'Print document action.'),
  textColor: message('core.toolbar.textColor', 'Text Color', 'Text color dropdown name.'),
  textColorDefault: message(
    'core.toolbar.textColorDefault',
    'Default',
    'Default text color option.'
  ),
  highlight: message('core.toolbar.highlight', 'Highlight', 'Highlight formatting action.'),
  noHighlight: message('core.toolbar.noHighlight', 'No highlight', 'Remove highlighting action.'),
  textAlignment: message(
    'core.toolbar.textAlignment',
    'Text Alignment',
    'Text alignment dropdown name.'
  ),
  alignLeft: message('core.toolbar.alignLeft', 'Align Left', 'Left text alignment action.'),
  alignCenter: message('core.toolbar.alignCenter', 'Align Center', 'Center text alignment action.'),
  alignRight: message('core.toolbar.alignRight', 'Align Right', 'Right text alignment action.'),
  justify: message('core.toolbar.justify', 'Justify', 'Justified text alignment action.'),
  invisibleCharacters: message(
    'core.toolbar.invisibleCharacters',
    'Invisible Characters',
    'Show invisible characters action.'
  ),
  clearFormatting: message(
    'core.toolbar.clearFormatting',
    'Clear Formatting',
    'Clear formatting action.'
  ),
  undo: message('core.toolbar.undo', 'Undo', 'Undo action.'),
  redo: message('core.toolbar.redo', 'Redo', 'Redo action.'),
  notionColorLabel: message(
    'core.colorPicker.label',
    'Text and background color',
    'Accessible name of the text and background color picker.'
  ),
  placeholderDefault: message(
    'core.placeholder.default',
    'Write something …',
    'Default empty textblock placeholder.'
  ),
  linkUrlPlaceholder: message(
    'core.linkPopover.urlPlaceholder',
    'Enter URL...',
    'URL input placeholder.'
  ),
  linkUrlLabel: message('core.linkPopover.urlLabel', 'URL', 'Accessible name of the URL input.'),
  linkApply: message('core.linkPopover.apply', 'Apply link', 'Apply link action.'),
  linkRemove: message('core.linkPopover.remove', 'Remove link', 'Remove link action.'),
  taskStatus: message('core.taskItem.status', 'Task status', 'Accessible name of a task checkbox.'),
  groupFormat: message('core.group.format', 'format', 'Display name of the format toolbar group.'),
  groupBlocks: message('core.group.blocks', 'blocks', 'Display name of the blocks toolbar group.'),
  groupListsToolbar: message(
    'core.group.lists',
    'lists',
    'Display name of the lists toolbar group.'
  ),
  groupTextStyle: message(
    'core.group.textStyle',
    'textStyle',
    'Display name of the textStyle toolbar group.'
  ),
  groupAlignment: message(
    'core.group.alignment',
    'alignment',
    'Display name of the alignment toolbar group.'
  ),
  groupHistory: message(
    'core.group.history',
    'history',
    'Display name of the history toolbar group.'
  ),
  groupDocument: message(
    'core.group.document',
    'document',
    'Display name of the document toolbar group.'
  ),
  groupUtilities: message(
    'core.group.utilities',
    'utilities',
    'Display name of the utilities toolbar group.'
  ),
  groupUtility: message(
    'core.group.utility',
    'utility',
    'Display name of the utility toolbar group.'
  ),
  groupInsert: message('core.group.insert', 'insert', 'Display name of the insert toolbar group.'),
  groupBasic: message('core.group.basic', 'Basic', 'Basic insertion group name.'),
  groupLists: message('core.group.listInsert', 'Lists', 'List insertion group name.'),
  headingLevel: defineMessage({
    id: 'core.heading.level',
    defaultValue: ({ level }) => `Heading ${String(level)}`,
    description: 'Heading insertion or formatting action with its numeric level.',
    owner: '@domternal/core',
    technicalAliases: ['heading', 'title'],
  }),
} as const;
