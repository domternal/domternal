import type { I18nService } from '@domternal/core';
import type { EditorView } from '@domternal/pm/view';
import type { PasteDiagnostic, PasteDiagnosticCode } from './html/types.js';
import { pasteCleanupMessages } from './messages.js';

export interface PasteFeedbackResult {
  readonly status: 'applied' | 'rejected' | 'untracked' | 'noop';
  readonly diagnostics: readonly PasteDiagnostic[];
  readonly diagnosticsTruncated: boolean;
}

export interface PasteFeedbackRenderer {
  update(result: PasteFeedbackResult): void;
  /** Reattach next to a moved or adopted view without changing the editor. */
  refresh(): void;
  dispose(): void;
}

type Copy = (typeof pasteCleanupMessages)[keyof typeof pasteCleanupMessages];
const diagnosticMessages: Readonly<Record<PasteDiagnosticCode, Copy>> = {
  'input-limit': pasteCleanupMessages.inputLimit,
  'structure-limit': pasteCleanupMessages.structureLimit,
  'parse-failed': pasteCleanupMessages.parseFailed,
  'unsafe-content-removed': pasteCleanupMessages.unsafeContent,
  'unsupported-formatting': pasteCleanupMessages.unsupportedFormatting,
  'image-removed': pasteCleanupMessages.imageRemoved,
  'link-removed': pasteCleanupMessages.linkRemoved,
  'formatting-adapted': pasteCleanupMessages.formattingAdapted,
  'office-list-unsupported': pasteCleanupMessages.officeListUnsupported,
};

interface Presentation {
  status: PasteFeedbackResult['status'];
  details: Copy[];
  images: boolean;
  truncated: boolean;
}

function presentation(result: PasteFeedbackResult): Presentation {
  const details = new Set<Copy>();
  let images = false;
  const maximum = Math.min(result.diagnostics.length, 100);
  for (let index = 0; index < maximum; index++) {
    const diagnostic = result.diagnostics[index];
    if (diagnostic === undefined || diagnostic.severity === 'info') continue;
    const known = Object.hasOwn(diagnosticMessages, diagnostic.code);
    details.add(known ? diagnosticMessages[diagnostic.code] : pasteCleanupMessages.other);
    images ||= diagnostic.code === 'image-removed';
  }
  return { status: result.status, details: [...details], images, truncated: result.diagnosticsTruncated || result.diagnostics.length > maximum };
}

/**
 * Owner-document UI only: no clipboard access, editor commands or source markup.
 * The caller owns operation receipts and calls refresh from its view lifecycle.
 */
export function createPasteFeedback(view: Pick<EditorView, 'dom'>, i18n: I18nService): PasteFeedbackRenderer {
  const doc = view.dom.ownerDocument;
  const notice = doc.createElement('div');
  notice.className = 'dm-paste-feedback';
  notice.contentEditable = 'false';
  notice.setAttribute('role', 'region');
  notice.hidden = true;
  const header = doc.createElement('div');
  header.className = 'dm-paste-feedback__header';
  const status = doc.createElement('p');
  status.className = 'dm-paste-feedback__status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  const dismiss = doc.createElement('button');
  dismiss.className = 'dm-paste-feedback__dismiss';
  dismiss.type = 'button';
  const dismissText = doc.createElement('span');
  dismiss.append(dismissText);
  header.append(status, dismiss);
  const recovery = doc.createElement('p');
  recovery.className = 'dm-paste-feedback__recovery';
  const details = doc.createElement('details');
  details.className = 'dm-paste-feedback__details';
  const summary = doc.createElement('summary');
  const list = doc.createElement('ul');
  const truncated = doc.createElement('p');
  details.append(summary, list, truncated);
  notice.append(header, recovery, details);
  let current: Presentation | undefined;
  let dismissed = false;
  let disposed = false;
  let rendering = false;

  const attach = (): void => {
    const parent = view.dom.parentNode;
    if (parent === null) { notice.remove(); return; }
    if (notice.parentNode !== parent || view.dom.nextSibling !== notice) parent.insertBefore(notice, view.dom.nextSibling);
  };
  const text = (element: HTMLElement, definition: Copy): void => {
    const message = i18n.resolve({ ...definition });
    if (element.textContent !== message.text) element.textContent = message.text;
    if (element.lang !== message.language) element.lang = message.language;
  };
  const renderPass = (): void => {
    if (disposed) return;
    attach();
    const label = i18n.resolve(pasteCleanupMessages.label);
    notice.setAttribute('aria-label', label.text);
    notice.lang = label.language;
    text(dismissText, pasteCleanupMessages.dismiss);
    const dismissLabel = i18n.resolve(pasteCleanupMessages.dismissLabel);
    dismiss.setAttribute('aria-label', dismissLabel.text);
    dismiss.lang = dismissLabel.language;
    text(summary, pasteCleanupMessages.details);
    if (current === undefined) return;
    notice.dataset['status'] = current.status;
    const visible = !dismissed && (current.status === 'rejected' || current.details.length > 0 || current.truncated);
    notice.hidden = !visible;
    if (!visible) { status.textContent = ''; return; }
    text(status, pasteCleanupMessages[current.status]);
    recovery.hidden = !current.images && current.status !== 'rejected';
    text(recovery, current.images ? pasteCleanupMessages.imageRecovery : pasteCleanupMessages.rejectedRecovery);
    details.hidden = current.details.length === 0 && !current.truncated;
    // Only static diagnostic definitions enter this list, never offsets or payloads.
    current.details.forEach((definition, index) => {
      let row = list.children.item(index) as HTMLLIElement | null;
      if (row === null) {
        row = notice.ownerDocument.createElement('li');
        list.append(row);
      }
      text(row, definition);
    });
    while (list.children.length > current.details.length) list.lastElementChild?.remove();
    truncated.hidden = !current.truncated;
    text(truncated, pasteCleanupMessages.truncated);
  };
  const render = (): void => {
    if (disposed || rendering) return;
    rendering = true;
    try {
      // A host resolver can synchronously replace locale settings. Repaint the
      // latest revision without recursive rendering or an unbounded host loop.
      for (let attempt = 0; attempt < 4; attempt++) {
        const revision = i18n.getSnapshot().revision;
        renderPass();
        // A host resolver can dispose this renderer during message resolution.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (disposed || revision === i18n.getSnapshot().revision) break;
      }
    } finally { rendering = false; }
  };
  const hide = (): void => { dismissed = true; notice.hidden = true; status.textContent = ''; };
  const escape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    hide();
  };
  dismiss.addEventListener('click', hide);
  notice.addEventListener('keydown', escape);
  const unsubscribe = i18n.subscribe(render);
  render();
  return {
    update(result) {
      if (disposed) return;
      current = presentation(result);
      dismissed = false;
      details.open = false;
      render();
    },
    refresh: render,
    dispose() {
      if (disposed) return;
      disposed = true;
      current = undefined;
      unsubscribe();
      dismiss.removeEventListener('click', hide);
      notice.removeEventListener('keydown', escape);
      notice.remove();
    },
  };
}
