import { defineMessage } from '@domternal/core';

declare module '@domternal/core' {
  interface MessageParameters {
    'image.toolbar.insert': undefined;
    'image.float.none': undefined;
    'image.float.left': undefined;
    'image.float.center': undefined;
    'image.float.right': undefined;
    'image.align.left': undefined;
    'image.align.center': undefined;
    'image.align.right': undefined;
    'image.action.editAlt': undefined;
    'image.action.delete': undefined;
    'image.insert.label': undefined;
    'image.insert.description': undefined;
    'image.group.float': undefined;
    'image.group.align': undefined;
    'image.group.actions': undefined;
    'image.popover.urlPlaceholder': undefined;
    'image.popover.urlLabel': undefined;
    'image.popover.altPlaceholder': undefined;
    'image.popover.altLabel': undefined;
    'image.popover.insert': undefined;
    'image.popover.saveAlt': undefined;
    'image.popover.browse': undefined;
  }
  interface SearchableMessages {
    'image.insert.label': true;
  }
}

/** English UI definitions owned by the image extension. */
export const imageMessages = {
  insertToolbar: defineMessage({
    id: 'image.toolbar.insert', defaultValue: 'Insert Image', owner: '@domternal/extension-image',
    description: 'Main toolbar image insertion action.',
  }),
  floatNone: defineMessage({
    id: 'image.float.none', defaultValue: 'Inline', owner: '@domternal/extension-image',
    description: 'Image placement without text wrapping.',
  }),
  floatLeft: defineMessage({
    id: 'image.float.left', defaultValue: 'Float left', owner: '@domternal/extension-image',
    description: 'Place the image on the left with wrapping text.',
  }),
  floatCenter: defineMessage({
    id: 'image.float.center', defaultValue: 'Center', owner: '@domternal/extension-image',
    description: 'Center a floating image.',
  }),
  floatRight: defineMessage({
    id: 'image.float.right', defaultValue: 'Float right', owner: '@domternal/extension-image',
    description: 'Place the image on the right with wrapping text.',
  }),
  alignLeft: defineMessage({
    id: 'image.align.left', defaultValue: 'Align left', owner: '@domternal/extension-image',
    description: 'Align an image to the left without wrapping text.',
  }),
  alignCenter: defineMessage({
    id: 'image.align.center', defaultValue: 'Align center', owner: '@domternal/extension-image',
    description: 'Center an image without wrapping text.',
  }),
  alignRight: defineMessage({
    id: 'image.align.right', defaultValue: 'Align right', owner: '@domternal/extension-image',
    description: 'Align an image to the right without wrapping text.',
  }),
  editAlt: defineMessage({
    id: 'image.action.editAlt', defaultValue: 'Edit alt text', owner: '@domternal/extension-image',
    description: 'Action to edit image alternative text.',
  }),
  delete: defineMessage({
    id: 'image.action.delete', defaultValue: 'Delete', owner: '@domternal/extension-image',
    description: 'Delete the selected image.',
  }),
  insert: defineMessage({
    id: 'image.insert.label', defaultValue: 'Image', owner: '@domternal/extension-image',
    description: 'Image insertion menu label.',
    searchAliases: ['picture', 'photo'], technicalAliases: ['image', 'img'],
  }),
  description: defineMessage({
    id: 'image.insert.description', defaultValue: 'Upload or embed with a link', owner: '@domternal/extension-image',
    description: 'Image insertion menu description.',
    allowEmpty: true,
  }),
  floatGroup: defineMessage({
    id: 'image.group.float', defaultValue: 'image-float', owner: '@domternal/extension-image',
    description: 'Image float toolbar group label.',
  }),
  alignGroup: defineMessage({
    id: 'image.group.align', defaultValue: 'image-align', owner: '@domternal/extension-image',
    description: 'Image alignment toolbar group label.',
  }),
  actionsGroup: defineMessage({
    id: 'image.group.actions', defaultValue: 'image-actions', owner: '@domternal/extension-image',
    description: 'Image actions toolbar group label.',
  }),
  urlPlaceholder: defineMessage({
    id: 'image.popover.urlPlaceholder', defaultValue: 'Image URL...', owner: '@domternal/extension-image',
    description: 'Placeholder for the image URL input.',
    allowEmpty: true,
  }),
  urlLabel: defineMessage({
    id: 'image.popover.urlLabel', defaultValue: 'Image URL', owner: '@domternal/extension-image',
    description: 'Accessible name of the image URL input.',
  }),
  altPlaceholder: defineMessage({
    id: 'image.popover.altPlaceholder', defaultValue: 'Alt text (optional)...', owner: '@domternal/extension-image',
    description: 'Placeholder for image alternative text.',
    allowEmpty: true,
  }),
  altLabel: defineMessage({
    id: 'image.popover.altLabel', defaultValue: 'Image alt text', owner: '@domternal/extension-image',
    description: 'Accessible name of the image alternative text input.',
  }),
  applyInsert: defineMessage({
    id: 'image.popover.insert', defaultValue: 'Insert image', owner: '@domternal/extension-image',
    description: 'Apply image insertion action.',
  }),
  applyAlt: defineMessage({
    id: 'image.popover.saveAlt', defaultValue: 'Save alt text', owner: '@domternal/extension-image',
    description: 'Save image alternative text action.',
  }),
  browse: defineMessage({
    id: 'image.popover.browse', defaultValue: 'Browse files', owner: '@domternal/extension-image',
    description: 'Browse local image files action.',
  }),
} as const;
