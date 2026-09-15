import { defineMessage } from '@domternal/core';

declare module '@domternal/core' {
  interface MessageParameters {
    'math.inline.label': undefined;
    'math.inline.description': undefined;
    'math.block.label': undefined;
    'math.block.description': undefined;
    'math.empty': undefined;
    'math.source.label': undefined;
    'math.preview.placeholder': undefined;
  }
  interface SearchableMessages {
    'math.inline.label': true;
    'math.block.label': true;
  }
}

/** English placeholder retained for consumers of the node view helper. */
export const MATH_PLACEHOLDER = 'New equation';

/** English UI definitions owned by the math package. */
export const mathMessages = {
  inline: defineMessage({
    id: 'math.inline.label', defaultValue: 'Inline equation', owner: '@domternal/extension-math',
    description: 'Insert an inline equation.', technicalAliases: ['math', 'latex', 'equation', 'formula', 'inline'],
  }),
  inlineDescription: defineMessage({
    id: 'math.inline.description', defaultValue: 'Insert an inline LaTeX formula', owner: '@domternal/extension-math',
    description: 'Description of the inline equation insertion action.', allowEmpty: true,
  }),
  block: defineMessage({
    id: 'math.block.label', defaultValue: 'Equation', owner: '@domternal/extension-math',
    description: 'Insert a block equation.', technicalAliases: ['math', 'latex', 'equation', 'formula', 'block', 'display'],
  }),
  blockDescription: defineMessage({
    id: 'math.block.description', defaultValue: 'Insert a block LaTeX formula', owner: '@domternal/extension-math',
    description: 'Description of the block equation insertion action.', allowEmpty: true,
  }),
  empty: defineMessage({
    id: 'math.empty', defaultValue: MATH_PLACEHOLDER, owner: '@domternal/extension-math',
    description: 'Placeholder inside a new equation with no LaTeX source.', allowEmpty: true,
  }),
  source: defineMessage({
    id: 'math.source.label', defaultValue: 'LaTeX source', owner: '@domternal/extension-math',
    description: 'Accessible name of the LaTeX source input.',
  }),
  preview: defineMessage({
    id: 'math.preview.placeholder', defaultValue: 'Preview', owner: '@domternal/extension-math',
    description: 'Placeholder in the empty equation preview.', allowEmpty: true,
  }),
} as const;
