import type { AnyExtension } from '@domternal/core';
import { PasteCleanup } from '@domternal/extension-paste-cleanup';
import { createPasteFormattingControl } from './paste-formatting-control.js';

/** Disable cleanup to compare the core clipboard behavior in the same demo. */
export const demoPasteFormatting = new URLSearchParams(window.location.search).get('paste-cleanup') === 'off'
  ? undefined : createPasteFormattingControl();

export const demoPasteCleanupExtensions: AnyExtension[] =
  demoPasteFormatting === undefined ? [] : [PasteCleanup.configure({ formattingForPaste: () => demoPasteFormatting.formatting })];
