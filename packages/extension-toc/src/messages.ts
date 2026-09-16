import { defineMessage } from '@domternal/core';

declare module '@domternal/core' {
  interface MessageParameters {
    'toc.block.empty': undefined;
    'toc.outline.label': undefined;
    'toc.heading.fallback': { level: number };
    'toc.heading.label': { label: string; level: number };
    'toc.insert.label': undefined;
    'toc.insert.description': undefined;
  }
  interface SearchableMessages {
    'toc.insert.label': true;
  }
}

/** English UI definitions owned by the table of contents package. */
export const tocMessages = {
  empty: defineMessage({
    id: 'toc.block.empty', defaultValue: 'Add headings to create a table of contents.', owner: '@domternal/extension-toc',
    description: 'Placeholder inside a table of contents with no headings.', allowEmpty: true,
  }),
  outline: defineMessage({
    id: 'toc.outline.label', defaultValue: 'Document outline', owner: '@domternal/extension-toc',
    description: 'Accessible name of the floating document outline.',
  }),
  headingFallback: defineMessage({
    id: 'toc.heading.fallback', defaultValue: ({ level }, context) => `Heading level ${context.number(level)}`,
    owner: '@domternal/extension-toc', description: 'UI fallback for a heading whose user-authored text is empty.',
  }),
  headingLabel: defineMessage({
    id: 'toc.heading.label', defaultValue: ({ label, level }, context) => `${label} (heading ${context.number(level)})`,
    owner: '@domternal/extension-toc', description: 'Accessible outline tick name containing the user-authored heading text and level.',
  }),
  insert: defineMessage({
    id: 'toc.insert.label', defaultValue: 'Table of contents', owner: '@domternal/extension-toc',
    description: 'Table of contents insertion action.', technicalAliases: ['toc', 'outline', 'contents'],
  }),
  description: defineMessage({
    id: 'toc.insert.description', defaultValue: 'List of headings on this page', owner: '@domternal/extension-toc',
    description: 'Description of the table of contents insertion action.', allowEmpty: true,
  }),
} as const;
