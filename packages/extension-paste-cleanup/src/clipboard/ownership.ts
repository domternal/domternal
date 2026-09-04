import { ExtensionConfigurationError } from '@domternal/core';

/** A Core clipboard slot that accepts one registration per editor. */
export type ClipboardSlot = 'copy-annotation' | 'html-preparation';

const guidance: Readonly<Record<ClipboardSlot, string>> = {
  'copy-annotation': 'PasteCleanup: this editor already has a clipboard copy annotation, and Core accepts one per editor. '
    + 'PasteCleanup owns it to recognize copies from this editor as its own. Remove the other extension or code that calls '
    + 'registerClipboardCopyAnnotation on this editor, or leave PasteCleanup out of this editor.',
  'html-preparation': 'PasteCleanup: this editor already has a clipboard HTML preparation, and Core accepts one per editor. '
    + 'PasteCleanup owns it when imageAssets is enabled, to prepare pasted local images. Remove the other extension or code '
    + 'that calls registerClipboardHTMLPreparation on this editor, or set imageAssets to false to leave the preparation to it. '
    + 'To keep pasted images in application storage, use imageAssets with mode \'resolver\' instead of a separate preparation.',
};

/**
 * Register one of Core's single clipboard slots for PasteCleanup. A plugin view registers on a live
 * view with valid arguments, so Core refuses only because another registration already holds the
 * slot. That refusal becomes a configuration error naming the slot, with Core's error as its cause.
 */
export function claimClipboardSlot(slot: ClipboardSlot, register: () => () => void): () => void {
  try {
    return register();
  } catch (error) {
    throw new ExtensionConfigurationError(guidance[slot], { cause: error });
  }
}
