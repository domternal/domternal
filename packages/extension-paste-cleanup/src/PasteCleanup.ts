import { Extension } from '@domternal/core';
import { Plugin, PluginKey } from '@domternal/pm/state';
import { normalizePasteHTML, DEFAULT_PASTE_HTML_LIMITS } from './html/index.js';
import type { NormalizePasteHTMLOptions, NormalizePasteHTMLResult } from './html/index.js';

export interface PasteCleanupOptions extends NormalizePasteHTMLOptions {
  /** Observe cleanup diagnostics. Exceptions from this observer never bypass cleanup. */
  onResult?: (result: NormalizePasteHTMLResult) => void;
}

const pasteCleanupKey = new PluginKey('pasteCleanup');

/** Opt-in cleanup. Plain text, source Markdown, and code-block paste retain their normal routing. */
export const PasteCleanup = Extension.create<PasteCleanupOptions>({
  name: 'pasteCleanup',
  priority: 1200,

  addOptions() { return { formatting: 'preserve', allowRemoteImages: false, allowDataImages: true }; },

  addProseMirrorPlugins() {
    const options = { ...this.options, limits: { ...this.options.limits } };
    // Configuration errors belong to editor setup, before a native paste event.
    normalizePasteHTML('', options);
    let rejected = false;
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
    const report = (result: NormalizePasteHTMLResult): void => {
      try { options.onResult?.(result); } catch { /* Host feedback cannot disable sanitization. */ }
    };
    return [new Plugin({
      key: pasteCleanupKey,
      props: {
        handleDOMEvents: {
          paste(view, event) {
            rejected = false;
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
              report({ status: 'rejected', html: '', source: 'html', diagnostics: [{ code: 'parse-failed', severity: 'error' }], diagnosticsTruncated: false });
              return true;
            }
            if (overLimit) {
              event.preventDefault();
              report({ status: 'rejected', html: '', source: 'html', diagnostics: [{ code: 'input-limit', severity: 'error' }], diagnosticsTruncated: false });
              return true;
            }
            return false;
          },
        },
        transformPastedText(text, _plain, view) {
          rejected = tooComplex(text, view.state.selection.$from.parent.type.spec.code === true);
          if (!rejected) return text;
          report({ status: 'rejected', html: '', source: 'html', diagnostics: [{ code: 'input-limit', severity: 'error' }], diagnosticsTruncated: false });
          return '';
        },
        transformPastedHTML(html) {
          const result = normalizePasteHTML(html, options);
          rejected = result.status === 'rejected';
          const cleaned = result.html;
          report(result);
          return cleaned;
        },
        handlePaste(_view, event) {
          const block = rejected;
          rejected = false;
          if (block) event.preventDefault();
          return block;
        },
      },
    })];
  },
});
