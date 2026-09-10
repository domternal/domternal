import type { I18nService } from '@domternal/core';
import type { EditorView } from '@domternal/pm/view';
import type { PasteDiagnostic, PasteDiagnosticCode } from './html/types.js';
import { pasteCleanupMessages } from './messages.js';
import type { PasteOperationRejectionReason } from './operations.js';

export interface PasteFeedbackResult {
  readonly status: 'applied' | 'rejected' | 'untracked' | 'noop';
  readonly diagnostics: readonly PasteDiagnostic[];
  readonly diagnosticsTruncated: boolean;
  readonly reason?: PasteOperationRejectionReason;
}

export interface PasteFeedbackRenderer {
  /** Show pending preparation. Dismissing its notice never calls cancel. */
  preparing(operationId: string, cancel: () => void): void;
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
  'destination-formatting-unconfirmed': pasteCleanupMessages.destinationFormattingUnconfirmed,
  'destination-table-unsupported': pasteCleanupMessages.destinationTableUnsupported,
  'destination-heading-level-adapted': pasteCleanupMessages.destinationHeadingLevelAdapted,
};

interface Presentation {
  status: PasteFeedbackResult['status'];
  details: Copy[];
  images: boolean;
  truncated: boolean;
  title: Copy;
  recovery: Copy;
}

interface Resolved {
  readonly text: string;
  readonly language: string;
}

interface PendingPresentation {
  status: 'preparing';
  operationId: string;
  cancel: () => void;
}

const rejectionMessages: Readonly<Record<Exclude<PasteOperationRejectionReason, 'cancelled' | 'superseded'>, {
  title: Copy; recovery: Copy;
}>> = {
  'target-changed': { title: pasteCleanupMessages.targetChanged, recovery: pasteCleanupMessages.targetChangedRecovery },
  'unsupported-destination': { title: pasteCleanupMessages.unsupportedDestination, recovery: pasteCleanupMessages.unsupportedDestinationRecovery },
  'unsupported-content': { title: pasteCleanupMessages.rejected, recovery: pasteCleanupMessages.unsupportedContentRecovery },
  'assets-unavailable': { title: pasteCleanupMessages.assetsUnavailable, recovery: pasteCleanupMessages.copyAgainRecovery },
  'asset-limit': { title: pasteCleanupMessages.assetLimit, recovery: pasteCleanupMessages.assetLimitRecovery },
  'asset-read-failed': { title: pasteCleanupMessages.assetReadFailed, recovery: pasteCleanupMessages.copyAgainRecovery },
};

function presentation(result: PasteFeedbackResult): Presentation | undefined {
  const reason = result.status === 'rejected' ? result.reason : undefined;
  if (reason === 'cancelled' || reason === 'superseded') return undefined;
  const details = new Set<Copy>();
  let images = false;
  let retainedInfo = false;
  const maximum = Math.min(result.diagnostics.length, 100);
  for (let index = 0; index < maximum; index++) {
    const diagnostic = result.diagnostics[index];
    if (diagnostic === undefined) continue;
    if (diagnostic.severity === 'info') { retainedInfo = true; continue; }
    const known = Object.hasOwn(diagnosticMessages, diagnostic.code);
    details.add(known ? diagnosticMessages[diagnostic.code] : pasteCleanupMessages.other);
    images ||= diagnostic.code === 'image-removed';
  }
  const copy = reason !== undefined && Object.hasOwn(rejectionMessages, reason) ? rejectionMessages[reason] : undefined;
  // Severity-ranked retention replaces an informational finding before it drops a warning or an error,
  // so a retained info proves that only informational findings, which the notice never lists, were dropped.
  const truncated = (result.diagnosticsTruncated && !retainedInfo) || result.diagnostics.length > maximum;
  return {
    status: result.status, details: [...details], images, truncated,
    title: copy?.title ?? pasteCleanupMessages[result.status],
    recovery: copy?.recovery ?? (images ? pasteCleanupMessages.imageRecovery : pasteCleanupMessages.rejectedRecovery),
  };
}

/**
 * Owner-document UI only: no clipboard access, editor commands or source markup.
 * The caller owns operation receipts and calls refresh from its view lifecycle.
 * `focus` returns keyboard focus to the editor when the notice hides under it.
 */
export function createPasteFeedback(view: Pick<EditorView, 'dom' | 'focus'>, i18n: I18nService): PasteFeedbackRenderer {
  const doc = view.dom.ownerDocument;
  const notice = doc.createElement('div');
  notice.className = 'dm-paste-feedback';
  notice.contentEditable = 'false';
  notice.setAttribute('role', 'region');
  notice.hidden = true;
  // The live region stays in the accessibility tree while the notice is hidden, because a
  // region that appears already filled is not reliably announced. It is visually hidden
  // through CSSOM properties, which a style-src policy allows, so it needs no theme.
  const announcer = doc.createElement('div');
  announcer.className = 'dm-paste-feedback__announcer';
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');
  announcer.setAttribute('aria-atomic', 'true');
  Object.assign(announcer.style, {
    position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: '0', border: '0',
    overflow: 'hidden', clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap',
  });
  const header = doc.createElement('div');
  header.className = 'dm-paste-feedback__header';
  const status = doc.createElement('p');
  status.className = 'dm-paste-feedback__status';
  const dismiss = doc.createElement('button');
  dismiss.className = 'dm-paste-feedback__dismiss';
  dismiss.type = 'button';
  const dismissText = doc.createElement('span');
  dismiss.append(dismissText);
  const cancel = doc.createElement('button');
  cancel.className = 'dm-paste-feedback__dismiss dm-paste-feedback__cancel';
  cancel.type = 'button';
  cancel.hidden = true;
  const cancelText = doc.createElement('span');
  cancel.append(cancelText);
  header.append(status, dismiss, cancel);
  const recovery = doc.createElement('p');
  recovery.className = 'dm-paste-feedback__recovery';
  const details = doc.createElement('details');
  details.className = 'dm-paste-feedback__details';
  const summary = doc.createElement('summary');
  const list = doc.createElement('ul');
  const truncated = doc.createElement('p');
  details.append(summary, list, truncated);
  notice.append(header, recovery, details);
  let current: Presentation | PendingPresentation | undefined;
  let dismissed = false;
  let disposed = false;
  let rendering = false;
  let presentationRevision = 0;
  // What the live region last announced, so a repaint repeats nothing while a new operation
  // with the same title is announced again.
  let announced: { revision: number; text: string; language: string } | undefined;
  let announceTimer: { clear: () => void } | undefined;

  const attach = (): void => {
    const parent = view.dom.parentNode;
    if (parent === null) { notice.remove(); announcer.remove(); return; }
    if (notice.parentNode !== parent || view.dom.nextSibling !== notice) parent.insertBefore(notice, view.dom.nextSibling);
    if (announcer.parentNode !== parent || notice.nextSibling !== announcer) parent.insertBefore(announcer, notice.nextSibling);
  };
  const text = (element: HTMLElement, definition: Copy): Resolved => {
    const message = i18n.resolve({ ...definition });
    if (element.textContent !== message.text) element.textContent = message.text;
    if (element.lang !== message.language) element.lang = message.language;
    return message;
  };
  const silence = (): void => {
    announceTimer?.clear();
    announceTimer = undefined;
    announced = undefined;
    if (announcer.firstChild !== null) announcer.replaceChildren();
  };
  const announce = (message: Resolved, connectedBefore: boolean): void => {
    if (announced?.revision === presentationRevision && announced.text === message.text && announced.language === message.language) return;
    if (!connectedBefore) {
      // Just inserted, or detached until the next refresh: write once the region has been in
      // the accessibility tree, since one that appears already filled may go unannounced.
      const owner = announcer.ownerDocument.defaultView;
      if (announcer.isConnected && owner !== null && announceTimer === undefined) {
        const timer = owner.setTimeout(() => { announceTimer = undefined; render(); }, 50);
        announceTimer = { clear: () => { owner.clearTimeout(timer); } };
      }
      return;
    }
    announceTimer?.clear();
    announceTimer = undefined;
    announced = { revision: presentationRevision, text: message.text, language: message.language };
    // A new node each time, so a repeated title is announced again for a new operation.
    const line = announcer.ownerDocument.createElement('span');
    line.textContent = message.text;
    line.lang = message.language;
    announcer.replaceChildren(line);
  };
  const focusedWithin = (): Element | null => {
    const root = notice.getRootNode() as Document | ShadowRoot;
    const active = root.activeElement;
    return active !== null && notice.contains(active) ? active : null;
  };
  const focusLost = (): boolean => {
    const root = notice.getRootNode() as Document | ShadowRoot;
    const active = root.activeElement;
    return active === null || active === notice.ownerDocument.body;
  };
  const concealed = (element: Element): boolean => {
    for (let node: Element | null = element; node !== null && node !== announcer.parentElement; node = node.parentElement) {
      if (node instanceof HTMLElement && node.hidden) return true;
    }
    return false;
  };
  const returnFocus = (): void => {
    if (disposed) return;
    try { view.focus(); } catch { /* Focus is a convenience; a detached view keeps the notice usable. */ }
  };
  const renderPass = (): void => {
    if (disposed) return;
    // Focus inside a control that this pass hides returns to the editor instead of the page.
    const focused = focusedWithin();
    paint();
    if (focused !== null && concealed(focused)) returnFocus();
  };
  const paint = (): void => {
    const shown = current;
    const connectedBefore = announcer.isConnected;
    attach();
    const label = i18n.resolve(pasteCleanupMessages.label);
    notice.setAttribute('aria-label', label.text);
    notice.lang = label.language;
    text(dismissText, pasteCleanupMessages.dismiss);
    const dismissLabel = i18n.resolve(pasteCleanupMessages.dismissLabel);
    dismiss.setAttribute('aria-label', dismissLabel.text);
    dismiss.lang = dismissLabel.language;
    text(cancelText, pasteCleanupMessages.cancel);
    const cancelLabel = i18n.resolve(pasteCleanupMessages.cancelLabel);
    cancel.setAttribute('aria-label', cancelLabel.text);
    cancel.lang = cancelLabel.language;
    text(summary, pasteCleanupMessages.details);
    cancel.hidden = shown?.status !== 'preparing';
    if (shown === undefined) {
      delete notice.dataset['status'];
      notice.hidden = true;
      status.textContent = '';
      silence();
      recovery.hidden = true;
      recovery.textContent = '';
      details.hidden = true;
      list.replaceChildren();
      truncated.textContent = '';
      return;
    }
    notice.dataset['status'] = shown.status;
    if (shown.status === 'preparing') {
      notice.hidden = dismissed;
      if (dismissed) { status.textContent = ''; silence(); } else {
        announce(text(status, pasteCleanupMessages.preparing), connectedBefore);
      }
      recovery.hidden = true;
      recovery.textContent = '';
      details.hidden = true;
      list.replaceChildren();
      truncated.textContent = '';
      return;
    }
    const visible = !dismissed && (shown.status === 'rejected' || shown.details.length > 0 || shown.truncated);
    notice.hidden = !visible;
    if (!visible) { status.textContent = ''; silence(); return; }
    announce(text(status, shown.title), connectedBefore);
    recovery.hidden = !shown.images && shown.status !== 'rejected';
    text(recovery, shown.recovery);
    details.hidden = shown.details.length === 0 && !shown.truncated;
    // Only static diagnostic definitions enter this list, never offsets or payloads.
    shown.details.forEach((definition, index) => {
      let row = list.children.item(index) as HTMLLIElement | null;
      if (row === null) {
        row = notice.ownerDocument.createElement('li');
        list.append(row);
      }
      text(row, definition);
    });
    while (list.children.length > shown.details.length) list.lastElementChild?.remove();
    truncated.hidden = !shown.truncated;
    text(truncated, pasteCleanupMessages.truncated);
  };
  const render = (): void => {
    if (disposed || rendering) return;
    rendering = true;
    try {
      // A host resolver can replace locale settings or the pending presentation.
      // Repaint the latest revision without recursive rendering or a host loop.
      for (let attempt = 0; attempt < 4; attempt++) {
        const revision = i18n.getSnapshot().revision;
        const shownRevision = presentationRevision;
        renderPass();
        // A host resolver can dispose this renderer during message resolution.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (disposed || (revision === i18n.getSnapshot().revision && shownRevision === presentationRevision)) return;
      }
      // A continuously reentrant host must not leave an obsolete notice visible.
      const focused = focusedWithin();
      notice.hidden = true;
      status.textContent = '';
      silence();
      if (focused !== null) returnFocus();
    } finally { rendering = false; }
  };
  // Dismiss, Escape and Cancel act on the notice, so focus that was in it, or that a pointer
  // press on a button took to the page, goes back to the editor.
  const userHides = (): boolean => focusedWithin() !== null || focusLost();
  const hide = (): void => {
    const refocus = userHides();
    dismissed = true;
    presentationRevision++;
    notice.hidden = true;
    status.textContent = '';
    silence();
    if (refocus) returnFocus();
  };
  const cancelPreparation = (): void => {
    const pending = current;
    if (disposed || pending?.status !== 'preparing') return;
    const refocus = userHides();
    // Consume the old callback before invoking host code. Reentry can replace or
    // dispose the notice, and nothing after the callback overwrites that state.
    current = undefined;
    presentationRevision++;
    render();
    if (refocus) returnFocus();
    try { pending.cancel(); } catch { /* Host cancellation cannot escape a UI event. */ }
  };
  const escape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    hide();
  };
  dismiss.addEventListener('click', hide);
  cancel.addEventListener('click', cancelPreparation);
  notice.addEventListener('keydown', escape);
  const unsubscribe = i18n.subscribe(render);
  render();
  return {
    preparing(operationId, cancel) {
      if (disposed) return;
      current = { status: 'preparing', operationId, cancel };
      presentationRevision++;
      dismissed = false;
      details.open = false;
      render();
    },
    update(result) {
      if (disposed) return;
      current = presentation(result);
      presentationRevision++;
      dismissed = false;
      details.open = false;
      render();
    },
    refresh: render,
    dispose() {
      if (disposed) return;
      disposed = true;
      current = undefined;
      presentationRevision++;
      unsubscribe();
      dismiss.removeEventListener('click', hide);
      cancel.removeEventListener('click', cancelPreparation);
      notice.removeEventListener('keydown', escape);
      announceTimer?.clear();
      announceTimer = undefined;
      notice.remove();
      announcer.remove();
    },
  };
}
