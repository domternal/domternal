import { Extension, ExtensionConfigurationError } from '@domternal/core';
import { setClipboardPasteBehavior, armClipboardPasteTransaction, registerClipboardCopyAnnotation, pasteClipboardImageFiles, dropClipboardImageFiles } from '@domternal/core/clipboard';
import type { Editor } from '@domternal/core';
import { Plugin, PluginKey } from '@domternal/pm/state';
import { closeHistory } from '@domternal/pm/history';
import { Slice } from '@domternal/pm/model';
import { normalizePasteHTML, DEFAULT_PASTE_HTML_LIMITS } from './html/index.js';
import type { NormalizePasteHTMLOptions, NormalizePasteHTMLResult } from './html/index.js';
import { normalizeClipboardHTML } from './html/normalize.js';
import { imageStandIns } from './html/imageStandIns.js';
import { officeListCapabilities } from './listCapabilities.js';
import { getUnsupportedDestinationFeatures } from './destinationCapabilities.js';
import { pasteCleanupKey, receiptStateField } from './operations.js';
import type { PasteNormalizationContext, PasteOperationResult } from './operations.js';
import { createPasteTracking } from './tracking.js';
import type { PendingPasteOperation } from './tracking.js';
import { createPasteFeedback } from './feedback.js';
import type { PasteFeedbackRenderer } from './feedback.js';
import { createClipboardAssetCoordinator, resolveClipboardImageAssets } from './clipboard/coordinator.js';
import type { ClipboardAssetCoordinator } from './clipboard/coordinator.js';
import type { ClipboardImageAssetOptions, PastePreparationProgress } from './clipboard/types.js';
import { annotateOwnCopy, isOwnCopyNonce } from './clipboard/ownCopy.js';
import { claimClipboardSlot } from './clipboard/ownership.js';

export interface PasteCleanupOptions extends NormalizePasteHTMLOptions {
  /** Opt in to bounded local raster preparation with explicit rich-HTML bindings. */
  imageAssets?: false | ClipboardImageAssetOptions;
  /** Observe a cancellable preparation before any document mutation. */
  onPasteProgress?: (progress: PastePreparationProgress) => void;
  /** Use the built-in notice or provide an application-owned onPasteResult handler. */
  feedback?: 'default' | 'application';
  /** Observe cleanup diagnostics. Exceptions from this observer never bypass cleanup. */
  onResult?: (result: NormalizePasteHTMLResult & PasteNormalizationContext) => void;
  /** Observe the accepted operation after synchronous paste handlers and normalizers settle. */
  onPasteResult?: (result: PasteOperationResult) => void;
}

/** Opt-in cleanup. Plain text, source Markdown, and code-block paste retain their normal routing. */
export const PasteCleanup = Extension.create<PasteCleanupOptions>({
  name: 'pasteCleanup',
  priority: 1200,

  addOptions() { return { formatting: 'preserve', allowRemoteImages: false, allowDataImages: true, feedback: 'default' }; },

  addProseMirrorPlugins() {
    const options = { ...this.options, limits: { ...this.options.limits } };
    // Configuration errors belong to editor setup, before a native paste event.
    let imageAssets: ReturnType<typeof resolveClipboardImageAssets>;
    try {
      normalizePasteHTML('', options);
      imageAssets = resolveClipboardImageAssets(options.imageAssets);
      if (options.onPasteProgress !== undefined && typeof options.onPasteProgress !== 'function') throw new RangeError('onPasteProgress must be a function');
    }
    catch (error) { throw new ExtensionConfigurationError(`PasteCleanup: ${error instanceof Error ? error.message : 'Invalid normalization options'}`); }
    if (options.feedback !== 'default' && options.feedback !== 'application') {
      throw new ExtensionConfigurationError('PasteCleanup: feedback must be default or application');
    }
    if (options.feedback === 'application' && typeof options.onPasteResult !== 'function') {
      throw new ExtensionConfigurationError('PasteCleanup: application feedback requires onPasteResult');
    }
    const editor = this.editor as Editor | null;
    if (editor === null) throw new ExtensionConfigurationError('PasteCleanup: an editor instance is required');
    let feedback: PasteFeedbackRenderer | undefined;
    let coordinator: ClipboardAssetCoordinator | undefined;
    let latestOperationId: string | undefined;
    let disarm: (() => void) | undefined;
    const startAttempt = (): void => { disarm?.(); disarm = undefined; };
    const tracking = createPasteTracking(options.formatting ?? 'preserve', result => {
      try { if (latestOperationId === result.operationId) feedback?.update(result); } catch { /* Presentation failures do not suppress the host observer. */ }
      options.onPasteResult?.(result);
    });
    // Transforms do not receive the paste event. If an earlier handler consumes a
    // rejected programmatic paste, the next empty paste stays blocked until this
    // state clears. Empty slices must never bypass a current rejection.
    // standIns: the alt text cleanup left in place of the images it removed.
    let pending: { rejected: boolean; preserveOrderedListStart: boolean; operation?: PendingPasteOperation; standIns?: readonly string[] } = {
      rejected: false, preserveOrderedListStart: false,
    };
    const tooComplex = (text: string, code: boolean): boolean => {
      const maximum = options.limits.maxInputLength ?? DEFAULT_PASTE_HTML_LIMITS.maxInputLength;
      if (text.length > maximum) return true;
      if (code) return false;
      const maximumTokens = options.limits.maxNodes ?? DEFAULT_PASTE_HTML_LIMITS.maxNodes;
      let tokens = 0;
      for (const char of text) {
        if ('\r\n*_~`[]<>'.includes(char) && ++tokens > maximumTokens) return true;
      }
      return false;
    };
    const createOperation = (result?: NormalizePasteHTMLResult): PendingPasteOperation => {
      const operation = tracking.create(result);
      latestOperationId = operation.operationId;
      return operation;
    };
    const notify = (result: NormalizePasteHTMLResult, operation: PendingPasteOperation): void => {
      try { options.onResult?.({ ...result, ...tracking.context(operation) }); } catch { /* Host feedback cannot disable sanitization. */ }
    };
    const report = (result: NormalizePasteHTMLResult): PendingPasteOperation => {
      const operation = createOperation(result);
      notify(result, operation);
      return operation;
    };
    // Keep appended normalizers inside the accepted paste's history event. The
    // following root closes that event only if it is accepted by every filter.
    const historyKey = new PluginKey<boolean>('pasteCleanupAssetHistory');
    const history = imageAssets === undefined ? [] : [new Plugin<boolean>({
      key: historyKey,
      state: {
        init: () => false,
        apply: (transaction, previous) => transaction.getMeta('appendedTransaction') !== undefined
          ? previous : coordinator?.isAssetTransaction(transaction) === true,
      },
      filterTransaction(transaction, state) {
        // ProseMirror adds appendedTransaction metadata only after its filters.
        // Appended filters receive an intermediate state, never the installed one.
        if (state === editor.view.state && transaction.getMeta('appendedTransaction') === undefined &&
          (historyKey.getState(state) === true || coordinator?.isAssetTransaction(transaction) === true)) closeHistory(transaction);
        return true;
      },
    })];
    return [new Plugin({
      key: pasteCleanupKey,
      state: receiptStateField,
      filterTransaction: transaction => coordinator?.filterTransaction(transaction) ?? true,
      view: view => {
        // Claim Core's single clipboard slots before any other setup, so a refused claim
        // fails editor setup with guidance and leaves nothing of PasteCleanup behind.
        // Copies from this editor carry a same-page nonce that makes them recognizable own copies.
        const disposeCopyAnnotation = claimClipboardSlot('copy-annotation', () => registerClipboardCopyAnnotation(view, annotateOwnCopy));
        if (imageAssets !== undefined) {
          try {
            coordinator = createClipboardAssetCoordinator(view, imageAssets, options, {
              create: createOperation, notify, tracking,
              progress: progress => {
                feedback?.preparing(progress.operationId, progress.cancel);
                options.onPasteProgress?.(progress);
              },
            });
          } catch (error) {
            disposeCopyAnnotation();
            throw error;
          }
        }
        if (options.feedback === 'default') feedback = createPasteFeedback(view, editor.i18n);
        const refresh = (): void => { feedback?.refresh(); };
        const adopt = (): void => { coordinator?.adopt(); refresh(); };
        editor.on('adopt', adopt);
        return {
          update: updatedView => { tracking.observe(updatedView); coordinator?.observe(); refresh(); },
          destroy: () => {
            startAttempt(); disposeCopyAnnotation(); coordinator?.destroy(); coordinator = undefined;
            editor.off('adopt', adopt); feedback?.dispose(); feedback = undefined;
          },
        };
      },
      props: {
        handleDOMEvents: {
          paste(view, event) {
            startAttempt();
            pending = { rejected: false, preserveOrderedListStart: false };
            setClipboardPasteBehavior(view, event, {});
            if (coordinator?.capture(event) === true) return true;
            const clipboard = event.clipboardData;
            if (clipboard === null) return false;
            const maximum = options.limits.maxInputLength ?? DEFAULT_PASTE_HTML_LIMITS.maxInputLength;
            // Bound every source a downstream Markdown or image handler could read.
            let overLimit: boolean;
            try {
              overLimit = ['text/html', 'text/plain', 'text/rtf', 'Text', 'text/uri-list'].some(type => {
                const value = clipboard.getData(type);
                return value.length > maximum || (['text/plain', 'Text', 'text/uri-list'].includes(type) && tooComplex(value, view.state.selection.$from.parent.type.spec.code === true));
              });
            } catch {
              event.preventDefault();
              const operation = report({ status: 'rejected', html: '', source: 'html', diagnostics: [{ code: 'parse-failed', severity: 'error' }], diagnosticsTruncated: false });
              void tracking.finish(view, operation, true);
              return true;
            }
            if (overLimit) {
              event.preventDefault();
              const operation = report({ status: 'rejected', html: '', source: 'html', diagnostics: [{ code: 'input-limit', severity: 'error' }], diagnosticsTruncated: false });
              void tracking.finish(view, operation, true);
              return true;
            }
            return false;
          },
          drop() {
            // A drop starts a new attempt, as a paste does: files dropped without HTML reach no
            // transform, and must not inherit an earlier drop's operation or image stand-ins.
            startAttempt();
            pending = { rejected: false, preserveOrderedListStart: false };
            return false;
          },
        },
        transformPastedText(text, _plain, view) {
          startAttempt();
          if (coordinator?.ordinaryAttempt() === false) { pending = { rejected: true, preserveOrderedListStart: false }; return ''; }
          const rejected = tooComplex(text, view.state.selection.$from.parent.type.spec.code === true);
          const operation = rejected
            ? report({ status: 'rejected', html: '', source: 'html', diagnostics: [{ code: 'input-limit', severity: 'error' }], diagnosticsTruncated: false })
            : createOperation();
          void tracking.finish(view, operation, rejected);
          pending = { rejected, preserveOrderedListStart: false, operation };
          return rejected ? '' : text;
        },
        transformPastedHTML(html, view) {
          const owned = coordinator?.replayHTML(html);
          startAttempt();
          if (owned !== undefined) {
            pending = { rejected: owned.rejected, preserveOrderedListStart: owned.preserveOrderedListStart, operation: owned.operation };
            return owned.html;
          }
          if (coordinator?.ordinaryAttempt() === false) { pending = { rejected: true, preserveOrderedListStart: false }; return ''; }
          const { result, preserveOrderedListStart, destinationRejected } = normalizeClipboardHTML(
            html, options, () => officeListCapabilities(view.state.schema, view.dom.ownerDocument, { preserveMarkers: true }),
            undefined, features => getUnsupportedDestinationFeatures(view.state.schema, view.dom.ownerDocument, features),
            isOwnCopyNonce,
          );
          const rejected = result.status === 'rejected';
          const cleaned = result.html;
          const operation = report(result);
          void tracking.finish(view, operation, rejected, destinationRejected ? { reason: 'unsupported-content' } : {});
          // A host observer can synchronously paste again. Restore this operation after it returns.
          pending = { rejected, preserveOrderedListStart, operation, standIns: imageStandIns(result) };
          return cleaned;
        },
        handleDrop(view, event, slice, moved) {
          // A drop's image files win over its cleaned content, even content cleanup rejected, as its
          // HTML is not inserted. Without image assets they go to the image node here, so the one
          // file keeps the alt text cleanup left in place of the image.
          if (moved || coordinator !== undefined) return false;
          if (!dropClipboardImageFiles(view, event, slice, { imageStandIns: pending.standIns ?? [] })) return false;
          if (pending.operation !== undefined) tracking.replacedByFiles(pending.operation);
          pending = { rejected: false, preserveOrderedListStart: false };
          return true;
        },
        handlePaste(view, event, slice) {
          const owned = coordinator?.handleReplay(event, slice);
          if (owned !== undefined) {
            pending = { rejected: false, preserveOrderedListStart: false };
            setClipboardPasteBehavior(view, event, { assetsAlreadyHandled: true,
              preserveOrderedListStart: !owned.blocked && owned.preserveOrderedListStart });
            if (owned.blocked) event.preventDefault();
            else {
              disarm = armClipboardPasteTransaction(view, pasteCleanupKey, { operationId: owned.operation.operationId });
              tracking.recordSlice(owned.operation, slice);
            }
            return owned.blocked;
          }
          const standIns = pending.standIns ?? [];
          if (!pending.rejected && coordinator?.handleImageOnly(event, slice, standIns) === true) {
            // The prepared files replace the cleaned content, which reports no finding of its own.
            if (pending.operation !== undefined) tracking.replacedByFiles(pending.operation);
            pending = { rejected: false, preserveOrderedListStart: false };
            return true;
          }
          // Without image assets, the image node takes the clipboard's image files when the
          // cleaned content has no text of its own: only white space, format characters or the
          // alt text left in place of removed images. Core decides, as it does for every handler.
          if (!pending.rejected && coordinator === undefined && pasteClipboardImageFiles(view, event, slice, { imageStandIns: standIns })) {
            if (pending.operation !== undefined) tracking.replacedByFiles(pending.operation);
            pending = { rejected: false, preserveOrderedListStart: false };
            setClipboardPasteBehavior(view, event, { assetsAlreadyHandled: true });
            event.preventDefault();
            return true;
          }
          const rejected = pending.rejected;
          const operation = pending.operation;
          // An empty cleaned slice must not delete the user's current selection.
          const empty = operation !== undefined && slice.content.size === 0;
          const block = rejected || empty;
          setClipboardPasteBehavior(view, event, {
            preserveOrderedListStart: !block && slice.content.size > 0 && pending.preserveOrderedListStart,
            ...(coordinator?.assetsHandled(event) === true ? { assetsAlreadyHandled: true } : {}),
          });
          pending = { rejected: false, preserveOrderedListStart: false };
          if (operation !== undefined) {
            // A transform-skipping empty attempt can carry an older pending operation.
            if (empty && !rejected && slice !== Slice.empty) tracking.skip(operation);
            if (!block) {
              disarm = armClipboardPasteTransaction(view, pasteCleanupKey, { operationId: operation.operationId });
              // A heading finding follows the slice's headings into the document.
              tracking.recordSlice(operation, slice);
            }
          }
          if (block) event.preventDefault();
          return block;
        },
      },
    }), ...history];
  },
});
