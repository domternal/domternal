import { Extension, ExtensionConfigurationError, setClipboardPasteBehavior, armClipboardPasteTransaction } from '@domternal/core';
import type { Editor } from '@domternal/core';
import { Plugin } from '@domternal/pm/state';
import { Slice } from '@domternal/pm/model';
import { normalizePasteHTML, DEFAULT_PASTE_HTML_LIMITS } from './html/index.js';
import type { NormalizePasteHTMLOptions, NormalizePasteHTMLResult } from './html/index.js';
import { normalizeClipboardHTML } from './html/normalize.js';
import { officeListCapabilities } from './listCapabilities.js';
import { pasteCleanupKey, receiptStateField } from './operations.js';
import type { PasteNormalizationContext, PasteOperationResult } from './operations.js';
import { createPasteTracking } from './tracking.js';
import type { PendingPasteOperation } from './tracking.js';
import { createPasteFeedback } from './feedback.js';
import type { PasteFeedbackRenderer } from './feedback.js';

export interface PasteCleanupOptions extends NormalizePasteHTMLOptions {
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
    try { normalizePasteHTML('', options); }
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
    let disarm: (() => void) | undefined;
    const startAttempt = (): void => { disarm?.(); disarm = undefined; };
    const tracking = createPasteTracking(options.formatting ?? 'preserve', result => {
      try { feedback?.update(result); } catch { /* Presentation failures do not suppress the host observer. */ }
      options.onPasteResult?.(result);
    });
    // Transforms do not receive the paste event. If an earlier handler consumes a
    // rejected programmatic paste, the next empty paste stays blocked until this
    // state clears. Empty slices must never bypass a current rejection.
    let pending: { rejected: boolean; preserveOrderedListStart: boolean; operation?: PendingPasteOperation } = {
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
    const report = (result: NormalizePasteHTMLResult): PendingPasteOperation => {
      const operation = tracking.create(result);
      try { options.onResult?.({ ...result, ...tracking.context(operation) }); } catch { /* Host feedback cannot disable sanitization. */ }
      return operation;
    };
    return [new Plugin({
      key: pasteCleanupKey,
      state: receiptStateField,
      view: view => {
        if (options.feedback === 'default') feedback = createPasteFeedback(view, editor.i18n);
        const refresh = (): void => { feedback?.refresh(); };
        editor.on('adopt', refresh);
        return {
          update: updatedView => { tracking.observe(updatedView); refresh(); },
          destroy: () => { startAttempt(); editor.off('adopt', refresh); feedback?.dispose(); feedback = undefined; },
        };
      },
      props: {
        handleDOMEvents: {
          paste(view, event) {
            startAttempt();
            pending = { rejected: false, preserveOrderedListStart: false };
            setClipboardPasteBehavior(view, event, {});
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
              tracking.finish(view, operation, true);
              return true;
            }
            if (overLimit) {
              event.preventDefault();
              const operation = report({ status: 'rejected', html: '', source: 'html', diagnostics: [{ code: 'input-limit', severity: 'error' }], diagnosticsTruncated: false });
              tracking.finish(view, operation, true);
              return true;
            }
            return false;
          },
        },
        transformPastedText(text, _plain, view) {
          startAttempt();
          const rejected = tooComplex(text, view.state.selection.$from.parent.type.spec.code === true);
          const operation = rejected
            ? report({ status: 'rejected', html: '', source: 'html', diagnostics: [{ code: 'input-limit', severity: 'error' }], diagnosticsTruncated: false })
            : tracking.create();
          tracking.finish(view, operation, rejected);
          pending = { rejected, preserveOrderedListStart: false, operation };
          return rejected ? '' : text;
        },
        transformPastedHTML(html, view) {
          startAttempt();
          const { result, preserveOrderedListStart } = normalizeClipboardHTML(
            html, options, () => officeListCapabilities(view.state.schema, view.dom.ownerDocument),
          );
          const rejected = result.status === 'rejected';
          const cleaned = result.html;
          const operation = report(result);
          tracking.finish(view, operation, rejected);
          // A host observer can synchronously paste again. Restore this operation after it returns.
          pending = { rejected, preserveOrderedListStart, operation };
          return cleaned;
        },
        handlePaste(view, event, slice) {
          const rejected = pending.rejected;
          const operation = pending.operation;
          // An empty cleaned slice must not delete the user's current selection.
          const empty = operation !== undefined && slice.content.size === 0;
          const block = rejected || empty;
          setClipboardPasteBehavior(view, event, {
            preserveOrderedListStart: !block && slice.content.size > 0 && pending.preserveOrderedListStart,
          });
          pending = { rejected: false, preserveOrderedListStart: false };
          if (operation !== undefined) {
            // A transform-skipping empty attempt can carry an older pending operation.
            if (empty && !rejected && slice !== Slice.empty) tracking.skip(operation);
            if (!block) disarm = armClipboardPasteTransaction(view, pasteCleanupKey, { operationId: operation.operationId });
          }
          if (block) event.preventDefault();
          return block;
        },
      },
    })];
  },
});
