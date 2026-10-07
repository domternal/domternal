import type { AnyExtension } from '@domternal/core';
import { PasteCleanup } from '@domternal/extension-paste-cleanup';

/** Disable cleanup to compare the core clipboard behavior in the same demo. */
export const demoPasteCleanupExtensions: AnyExtension[] =
  new URLSearchParams(window.location.search).get('paste-cleanup') === 'off' ? [] : [PasteCleanup];
