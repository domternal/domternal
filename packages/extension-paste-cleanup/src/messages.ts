import { defineMessage } from '@domternal/core';

declare module '@domternal/core' {
  interface MessageParameters {
    'pasteCleanup.feedback.label': undefined;
    'pasteCleanup.feedback.applied': undefined;
    'pasteCleanup.feedback.rejected': undefined;
    'pasteCleanup.feedback.untracked': undefined;
    'pasteCleanup.feedback.noop': undefined;
    'pasteCleanup.feedback.preparing': undefined;
    'pasteCleanup.feedback.cancel': undefined;
    'pasteCleanup.feedback.cancelLabel': undefined;
    'pasteCleanup.feedback.targetChanged': undefined;
    'pasteCleanup.feedback.targetChangedRecovery': undefined;
    'pasteCleanup.feedback.unsupportedDestination': undefined;
    'pasteCleanup.feedback.unsupportedDestinationRecovery': undefined;
    'pasteCleanup.feedback.unsupportedContentRecovery': undefined;
    'pasteCleanup.feedback.assetsUnavailable': undefined;
    'pasteCleanup.feedback.assetLimit': undefined;
    'pasteCleanup.feedback.assetLimitRecovery': undefined;
    'pasteCleanup.feedback.assetReadFailed': undefined;
    'pasteCleanup.feedback.copyAgainRecovery': undefined;
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
    'pasteCleanup.diagnostic.destinationFormattingUnconfirmed': undefined;
    'pasteCleanup.diagnostic.destinationTableUnsupported': undefined;
    'pasteCleanup.diagnostic.destinationHeadingLevelAdapted': undefined;
    'pasteCleanup.diagnostic.hiddenTextRemoved': undefined;
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
  preparing: defineMessage({
    id: 'pasteCleanup.feedback.preparing', defaultValue: 'Preparing pasted images.', owner: '@domternal/extension-paste-cleanup',
    description: 'Nonmodal progress notice before prepared images are inserted.',
  }),
  cancel: defineMessage({
    id: 'pasteCleanup.feedback.cancel', defaultValue: 'Cancel', owner: '@domternal/extension-paste-cleanup',
    description: 'Explicitly cancel pending image preparation, independently of dismissing its notice.',
  }),
  cancelLabel: defineMessage({
    id: 'pasteCleanup.feedback.cancelLabel', defaultValue: 'Cancel image preparation', owner: '@domternal/extension-paste-cleanup',
    description: 'Accessible name of the pending image preparation cancellation button.',
  }),
  targetChanged: defineMessage({
    id: 'pasteCleanup.feedback.targetChanged', defaultValue: 'The paste destination changed.', owner: '@domternal/extension-paste-cleanup',
    description: 'Rejection notice when the captured editor destination is no longer current.',
  }),
  targetChangedRecovery: defineMessage({
    id: 'pasteCleanup.feedback.targetChangedRecovery', defaultValue: 'Choose where to paste, then paste again.', owner: '@domternal/extension-paste-cleanup',
    description: 'Recovery after the paste destination changed, without retrying at a stale location.',
  }),
  unsupportedDestination: defineMessage({
    id: 'pasteCleanup.feedback.unsupportedDestination', defaultValue: 'This editor cannot include the pasted images.', owner: '@domternal/extension-paste-cleanup',
    description: 'Rejection notice when the destination cannot accept the prepared embedded images.',
  }),
  unsupportedDestinationRecovery: defineMessage({
    id: 'pasteCleanup.feedback.unsupportedDestinationRecovery', defaultValue: "Paste as plain text, or use the editor's image insertion control if available.", owner: '@domternal/extension-paste-cleanup',
    description: 'Recovery for an unsupported image destination, without promising an insertion control exists.',
  }),
  unsupportedContentRecovery: defineMessage({
    id: 'pasteCleanup.feedback.unsupportedContentRecovery', defaultValue: 'Use an editor with table support, or paste as plain text.', owner: '@domternal/extension-paste-cleanup',
    description: 'Recovery when table structure cannot be represented by the destination schema.',
  }),
  assetsUnavailable: defineMessage({
    id: 'pasteCleanup.feedback.assetsUnavailable', defaultValue: 'The pasted images are unavailable.', owner: '@domternal/extension-paste-cleanup',
    description: 'Rejection notice when clipboard image resources cannot be reliably obtained or matched.',
  }),
  assetLimit: defineMessage({
    id: 'pasteCleanup.feedback.assetLimit', defaultValue: 'The pasted images exceed supported limits.', owner: '@domternal/extension-paste-cleanup',
    description: 'Rejection notice for image resource or generated content limits.',
  }),
  assetLimitRecovery: defineMessage({
    id: 'pasteCleanup.feedback.assetLimitRecovery', defaultValue: 'Try fewer or smaller images, or paste as plain text.', owner: '@domternal/extension-paste-cleanup',
    description: 'Recovery for bounded image preparation, without changing editor limits.',
  }),
  assetReadFailed: defineMessage({
    id: 'pasteCleanup.feedback.assetReadFailed', defaultValue: 'The pasted images could not be read.', owner: '@domternal/extension-paste-cleanup',
    description: 'Rejection notice when reading a captured image resource fails.',
  }),
  copyAgainRecovery: defineMessage({
    id: 'pasteCleanup.feedback.copyAgainRecovery', defaultValue: 'Copy the content again and paste, or paste as plain text.', owner: '@domternal/extension-paste-cleanup',
    description: 'Recovery for unavailable or unreadable clipboard images, without automatic clipboard access.',
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
  destinationFormattingUnconfirmed: defineMessage({
    id: 'pasteCleanup.diagnostic.destinationFormattingUnconfirmed', defaultValue: 'This editor may not preserve some pasted formatting.', owner: '@domternal/extension-paste-cleanup',
    description: 'A requested built-in schema capability was not confirmed by a reference parse probe; this does not assert exact content loss.',
  }),
  destinationTableUnsupported: defineMessage({
    id: 'pasteCleanup.diagnostic.destinationTableUnsupported', defaultValue: 'Table paste was blocked because table support could not be confirmed.', owner: '@domternal/extension-paste-cleanup',
    description: 'Table capability refusal before insertion, independently of diagnostic capacity.',
  }),
  destinationHeadingLevelAdapted: defineMessage({
    id: 'pasteCleanup.diagnostic.destinationHeadingLevelAdapted', defaultValue: 'Some headings were changed to a heading level this editor supports.', owner: '@domternal/extension-paste-cleanup',
    description: 'A pasted heading level the editor does not support became its nearest supported level instead of a paragraph.',
  }),
  hiddenTextRemoved: defineMessage({
    id: 'pasteCleanup.diagnostic.hiddenTextRemoved', defaultValue: 'Hidden text from Word was not pasted.', owner: '@domternal/extension-paste-cleanup',
    description: 'Text the Word document hides (Format > Font > Hidden) was in the copy and was left out of the paste, as Word does not show it.',
  }),
  other: defineMessage({
    id: 'pasteCleanup.diagnostic.other', defaultValue: 'Some pasted content may need review.', owner: '@domternal/extension-paste-cleanup',
    description: 'Bounded generic message for an unknown warning code, without displaying source data.',
  }),
} as const;
