// @domternal/core/clipboard: experimental clipboard coordination for extensions that
// cooperate on paste and copy. This list is the subpath's only source. Its declarations
// build from here, while tsup emits dist/clipboard.js and dist/clipboard.cjs as plain
// re-exports of the sibling main bundle, which carries these bindings through
// index.bundle.ts. The subpath therefore shares every registry with the main entry of
// the same installed copy and module format. ESM and CommonJS copies loaded side by
// side do not share state.
// A view accepts one HTML preparation coordinator and one copy annotation, and a second
// registration throws. A document import feature must not claim these slots on its own.
// Image destinations are a latest-wins stack instead: the latest active registration
// applies, disposing it restores the one before, and disposing an earlier one leaves the
// latest in place.
export {
  setClipboardPasteBehavior,
  getClipboardPasteBehavior,
  type ClipboardPasteBehavior,
} from './helpers/clipboardPasteBehavior.js';
export { armClipboardPasteTransaction } from './helpers/clipboardPasteTransaction.js';
export {
  registerClipboardImageDestination,
  getClipboardImageDestination,
  type ClipboardImageDestinationPolicy,
  type ClipboardImageFileInserter,
} from './helpers/clipboardImageDestination.js';
export {
  pasteHasOwnText,
  pasteClipboardImageFiles,
  type ClipboardImageFileInsertion,
  type ClipboardPasteTextOptions,
} from './helpers/clipboardImageFiles.js';
export { registerClipboardCopyAnnotation } from './helpers/clipboardCopyAnnotation.js';
export {
  registerClipboardHTMLPreparation,
  getClipboardPasteAttemptEvent,
  type ClipboardHTMLPreparationContext,
  type ClipboardHTMLDeferral,
  type ClipboardHTMLReplay,
} from './helpers/clipboardHTMLPreparation.js';
