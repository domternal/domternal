import { defineMessage } from '@domternal/core';

declare module '@domternal/core' {
  interface MessageParameters {
    'pasteCleanup.feedback.label': undefined;
    'pasteCleanup.feedback.applied': undefined;
    'pasteCleanup.feedback.rejected': undefined;
    'pasteCleanup.feedback.untracked': undefined;
    'pasteCleanup.feedback.noop': undefined;
    'pasteCleanup.feedback.details': undefined;
    'pasteCleanup.feedback.dismiss': undefined;
    'pasteCleanup.feedback.dismissLabel': undefined;
    'pasteCleanup.feedback.imageRecovery': undefined;
    'pasteCleanup.feedback.rejectedRecovery': undefined;
    'pasteCleanup.feedback.truncated': undefined;
    'pasteCleanup.diagnostic.inputLimit': undefined;
    'pasteCleanup.diagnostic.structureLimit': undefined;
    'pasteCleanup.diagnostic.parseFailed': undefined;
    'pasteCleanup.diagnostic.unsafeContent': undefined;
    'pasteCleanup.diagnostic.unsupportedFormatting': undefined;
    'pasteCleanup.diagnostic.imageRemoved': undefined;
    'pasteCleanup.diagnostic.linkRemoved': undefined;
    'pasteCleanup.diagnostic.formattingAdapted': undefined;
    'pasteCleanup.diagnostic.officeListUnsupported': undefined;
    'pasteCleanup.diagnostic.other': undefined;
  }
}

/** English UI definitions owned by the paste cleanup extension. */
export const pasteCleanupMessages = {
  label: defineMessage({
    id: 'pasteCleanup.feedback.label', defaultValue: 'Paste notice', owner: '@domternal/extension-paste-cleanup',
    description: 'Accessible name of the nonmodal paste feedback region.',
  }),
  applied: defineMessage({
    id: 'pasteCleanup.feedback.applied', defaultValue: 'Review the pasted content.', owner: '@domternal/extension-paste-cleanup',
    description: 'Notice for an applied paste with reported changes or incomplete diagnostics.',
  }),
  rejected: defineMessage({
    id: 'pasteCleanup.feedback.rejected', defaultValue: 'Paste was blocked.', owner: '@domternal/extension-paste-cleanup',
    description: 'Notice when the paste operation was rejected.',
  }),
  untracked: defineMessage({
    id: 'pasteCleanup.feedback.untracked', defaultValue: 'Check the paste result.', owner: '@domternal/extension-paste-cleanup',
    description: 'Notice with diagnostics when the insertion outcome could not be tracked.',
  }),
  noop: defineMessage({
    id: 'pasteCleanup.feedback.noop', defaultValue: 'Paste made no changes.', owner: '@domternal/extension-paste-cleanup',
    description: 'Notice with diagnostics when the paste made no document changes.',
  }),
  details: defineMessage({
    id: 'pasteCleanup.feedback.details', defaultValue: 'Details', owner: '@domternal/extension-paste-cleanup',
    description: 'Native disclosure control for paste diagnostics.',
  }),
  dismiss: defineMessage({
    id: 'pasteCleanup.feedback.dismiss', defaultValue: 'Dismiss', owner: '@domternal/extension-paste-cleanup',
    description: 'Button to dismiss the paste notice.',
  }),
  dismissLabel: defineMessage({
    id: 'pasteCleanup.feedback.dismissLabel', defaultValue: 'Dismiss paste notice', owner: '@domternal/extension-paste-cleanup',
    description: 'Accessible name of the paste notice dismissal button.',
  }),
  imageRecovery: defineMessage({
    id: 'pasteCleanup.feedback.imageRecovery', defaultValue: 'Paste missing images separately. If available, import the original DOCX file.', owner: '@domternal/extension-paste-cleanup',
    description: 'Available recovery guidance for images missing from clipboard content, without promising file import exists.',
  }),
  rejectedRecovery: defineMessage({
    id: 'pasteCleanup.feedback.rejectedRecovery', defaultValue: 'Try a smaller selection or paste as plain text.', owner: '@domternal/extension-paste-cleanup',
    description: 'Recovery guidance after a rejected paste, without retrying or reading the clipboard.',
  }),
  truncated: defineMessage({
    id: 'pasteCleanup.feedback.truncated', defaultValue: 'Not all paste details are shown.', owner: '@domternal/extension-paste-cleanup',
    description: 'Disclosure that diagnostics were bounded and this list is incomplete.',
  }),
  inputLimit: defineMessage({
    id: 'pasteCleanup.diagnostic.inputLimit', defaultValue: 'The clipboard content exceeds the paste size limit.', owner: '@domternal/extension-paste-cleanup',
    description: 'Diagnostic for the clipboard input size limit.',
  }),
  structureLimit: defineMessage({
    id: 'pasteCleanup.diagnostic.structureLimit', defaultValue: 'The clipboard content exceeds supported document limits.', owner: '@domternal/extension-paste-cleanup',
    description: 'Diagnostic for bounded document structure, images or generated content.',
  }),
  parseFailed: defineMessage({
    id: 'pasteCleanup.diagnostic.parseFailed', defaultValue: 'The clipboard content could not be read safely.', owner: '@domternal/extension-paste-cleanup',
    description: 'Diagnostic when clipboard parsing fails.',
  }),
  unsafeContent: defineMessage({
    id: 'pasteCleanup.diagnostic.unsafeContent', defaultValue: 'Unsupported or unsafe content was removed.', owner: '@domternal/extension-paste-cleanup',
    description: 'Diagnostic for removal of active or unsupported markup.',
  }),
  unsupportedFormatting: defineMessage({
    id: 'pasteCleanup.diagnostic.unsupportedFormatting', defaultValue: 'Some formatting could not be preserved.', owner: '@domternal/extension-paste-cleanup',
    description: 'Diagnostic for unsupported source formatting.',
  }),
  imageRemoved: defineMessage({
    id: 'pasteCleanup.diagnostic.imageRemoved', defaultValue: 'Some images could not be included.', owner: '@domternal/extension-paste-cleanup',
    description: 'Diagnostic for unavailable or removed images.',
  }),
  linkRemoved: defineMessage({
    id: 'pasteCleanup.diagnostic.linkRemoved', defaultValue: 'Some links were removed.', owner: '@domternal/extension-paste-cleanup',
    description: 'Diagnostic for unsafe or unresolved links.',
  }),
  formattingAdapted: defineMessage({
    id: 'pasteCleanup.diagnostic.formattingAdapted', defaultValue: 'Formatting was adapted to the editor.', owner: '@domternal/extension-paste-cleanup',
    description: 'Fallback detail if adaptation is explicitly reported with warning or error severity.',
  }),
  officeListUnsupported: defineMessage({
    id: 'pasteCleanup.diagnostic.officeListUnsupported', defaultValue: 'Some Office lists could not be reconstructed.', owner: '@domternal/extension-paste-cleanup',
    description: 'Diagnostic for unsupported Office list metadata or destination list capabilities.',
  }),
  other: defineMessage({
    id: 'pasteCleanup.diagnostic.other', defaultValue: 'Some pasted content may need review.', owner: '@domternal/extension-paste-cleanup',
    description: 'Bounded generic message for an unknown warning code, without displaying source data.',
  }),
} as const;
