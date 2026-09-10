import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document as DocumentNode, Editor, I18nService, Paragraph, Text } from '@domternal/core';
import { createPasteFeedback } from './feedback.js';
import type { PasteFeedbackRenderer, PasteFeedbackResult } from './feedback.js';
import type { PasteDiagnostic, PasteDiagnosticCode } from './html/types.js';
import { pasteCleanupMessages } from './messages.js';
import { deMessages } from './locales/de.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => { cleanup(); });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Match querySelector's explicit element type while requiring a fixture match.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function required<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing fixture element: ${selector}`);
  return element;
}

function fixture(i18n = new I18nService(), owner = document, parent?: HTMLElement | ShadowRoot): {
  host: HTMLDivElement; dom: HTMLDivElement; renderer: PasteFeedbackRenderer; notice: HTMLDivElement; i18n: I18nService;
} {
  const host = owner.createElement('div');
  (parent ?? owner.body).append(host);
  const dom = owner.createElement('div');
  dom.contentEditable = 'true';
  dom.tabIndex = 0;
  dom.textContent = 'Authored content';
  host.append(dom);
  const renderer = createPasteFeedback({ dom, focus: () => { dom.focus(); } }, i18n);
  const notice = required<HTMLDivElement>(host, '.dm-paste-feedback');
  cleanups.push(() => { renderer.dispose(); i18n.destroy(); host.remove(); });
  return { host, dom, renderer, notice, i18n };
}

function result(status: PasteFeedbackResult['status'] = 'applied', codes: readonly PasteDiagnosticCode[] = ['image-removed']): PasteFeedbackResult {
  return { status, diagnostics: codes.map(code => ({ code, severity: 'warning' })), diagnosticsTruncated: false };
}

describe('paste loss feedback', () => {
  it('shows preparation without focus theft, editor changes, old details or source identifiers', () => {
    const { dom, renderer, notice } = fixture();
    renderer.update(result('rejected'));
    required<HTMLDetailsElement>(notice, 'details').open = true;
    dom.focus();
    const cancel = vi.fn();
    renderer.preparing('private-operation-id', cancel);
    expect(notice.hidden).toBe(false);
    expect(notice.dataset['status']).toBe('preparing');
    expect(required(notice, '.dm-paste-feedback__status').textContent).toBe('Preparing pasted images.');
    expect(required(notice, '.dm-paste-feedback__cancel').hidden).toBe(false);
    expect(required(notice, '.dm-paste-feedback__cancel').getAttribute('aria-label')).toBe('Cancel image preparation');
    expect(required(notice, '.dm-paste-feedback__recovery').hidden).toBe(true);
    expect(required<HTMLDetailsElement>(notice, 'details').hidden).toBe(true);
    expect(required<HTMLDetailsElement>(notice, 'details').open).toBe(false);
    expect(notice.outerHTML).not.toContain('private-operation-id');
    expect(notice.querySelector('[autofocus], [aria-modal], [role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(dom);
    expect(dom.textContent).toBe('Authored content');
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each(['dismiss', 'escape'] as const)('keeps %s as presentation dismissal without cancelling pending work', action => {
    const { renderer, notice, i18n } = fixture();
    const cancel = vi.fn();
    renderer.preparing('pending', cancel);
    if (action === 'dismiss') required<HTMLButtonElement>(notice, '.dm-paste-feedback__dismiss').click();
    else notice.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    renderer.refresh();
    i18n.set({ locale: 'de', messages: deMessages });
    expect(notice.hidden).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    renderer.update(result('rejected', []));
    expect(notice.hidden).toBe(false);
    expect(required(notice, '.dm-paste-feedback__cancel').hidden).toBe(true);
    required<HTMLButtonElement>(notice, '.dm-paste-feedback__cancel').click();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('consumes explicit cancellation once and contains a throwing callback', () => {
    const { renderer, notice } = fixture();
    const cancel = vi.fn(() => { throw new Error('Private host failure'); });
    renderer.preparing('pending', cancel);
    const button = required<HTMLButtonElement>(notice, '.dm-paste-feedback__cancel');
    expect(() => { button.click(); }).not.toThrow();
    button.click();
    renderer.refresh();
    expect(cancel).toHaveBeenCalledOnce();
    expect(notice.hidden).toBe(true);
    expect(notice.textContent).not.toContain('Private host failure');
  });

  it.each(['pending', 'terminal', 'dispose'] as const)('preserves a reentrant %s replacement from cancellation', replacement => {
    const { renderer, notice, host } = fixture();
    const newerCancel = vi.fn();
    const oldCancel = vi.fn(() => {
      if (replacement === 'pending') renderer.preparing('newer', newerCancel);
      else if (replacement === 'terminal') renderer.update(result('rejected', ['link-removed']));
      else renderer.dispose();
      throw new Error('Old callback failed after replacement');
    });
    renderer.preparing('older', oldCancel);
    required<HTMLButtonElement>(notice, '.dm-paste-feedback__cancel').click();
    expect(oldCancel).toHaveBeenCalledOnce();
    if (replacement === 'pending') {
      expect(notice.hidden).toBe(false);
      expect(notice.dataset['status']).toBe('preparing');
      required<HTMLButtonElement>(notice, '.dm-paste-feedback__cancel').click();
      expect(newerCancel).toHaveBeenCalledOnce();
    } else if (replacement === 'terminal') {
      expect(notice.hidden).toBe(false);
      expect(notice.dataset['status']).toBe('rejected');
      expect(required(notice, '.dm-paste-feedback__cancel').hidden).toBe(true);
    } else expect(host.querySelector('.dm-paste-feedback')).toBeNull();
  });

  it('replaces pending callbacks by identity even when operation identifiers are reused', () => {
    const { renderer, notice } = fixture();
    const older = vi.fn();
    const newer = vi.fn();
    renderer.preparing('same-id', older);
    renderer.preparing('same-id', newer);
    required<HTMLButtonElement>(notice, '.dm-paste-feedback__cancel').click();
    expect(older).not.toHaveBeenCalled();
    expect(newer).toHaveBeenCalledOnce();
  });

  it('clears preparation controls after a clean result without a success notice', () => {
    const { renderer, notice } = fixture();
    const cancel = vi.fn();
    renderer.preparing('pending', cancel);
    renderer.update(result('applied', []));
    expect(notice.hidden).toBe(true);
    expect(notice.dataset['status']).toBe('applied');
    expect(required(notice, '.dm-paste-feedback__status').textContent).toBe('');
    expect(required(notice, '.dm-paste-feedback__cancel').hidden).toBe(true);
    required<HTMLButtonElement>(notice, '.dm-paste-feedback__cancel').click();
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'superseded'] as const)('quietly clears a %s operation including old diagnostics and cancellation', reason => {
    const { renderer, notice } = fixture();
    const cancel = vi.fn();
    renderer.preparing('pending', cancel);
    renderer.update({ ...result('rejected'), reason, diagnosticsTruncated: true });
    expect(notice.hidden).toBe(true);
    expect(notice.dataset['status']).toBeUndefined();
    expect(required(notice, '.dm-paste-feedback__status').textContent).toBe('');
    required<HTMLButtonElement>(notice, '.dm-paste-feedback__cancel').click();
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each([
    ['target-changed', 'The paste destination changed.', 'Choose where to paste, then paste again.'],
    ['unsupported-destination', 'This editor cannot include the pasted images.', "Paste as plain text, or use the editor's image insertion control if available."],
    ['assets-unavailable', 'The pasted images are unavailable.', 'Copy the content again and paste, or paste as plain text.'],
    ['asset-limit', 'The pasted images exceed supported limits.', 'Try fewer or smaller images, or paste as plain text.'],
    ['asset-read-failed', 'The pasted images could not be read.', 'Copy the content again and paste, or paste as plain text.'],
  ] as const)('uses accurate status and recovery for %s instead of generic image-loss guidance', (reason, status, recovery) => {
    const { renderer, notice } = fixture();
    renderer.preparing('pending', vi.fn());
    renderer.update({ ...result('rejected'), reason });
    expect(required(notice, '.dm-paste-feedback__status').textContent).toBe(status);
    expect(required(notice, '.dm-paste-feedback__recovery').textContent).toBe(recovery);
    expect(notice.hidden).toBe(false);
    expect(notice.dataset['status']).toBe('rejected');
    expect(required(notice, '.dm-paste-feedback__cancel').hidden).toBe(true);
  });

  it('does not mislabel an applied or uncertain result with a rejection reason', () => {
    const { renderer, notice } = fixture();
    for (const status of ['applied', 'untracked', 'noop'] as const) {
      renderer.update({ ...result(status), reason: 'cancelled' });
      expect(notice.hidden).toBe(false);
      expect(required(notice, '.dm-paste-feedback__status').textContent).toBe(pasteCleanupMessages[status].defaultValue);
    }
  });

  it('retains pending cancellation through live official German localization and document adoption', () => {
    const { renderer, notice, dom, i18n } = fixture();
    const cancel = vi.fn();
    renderer.preparing('pending', cancel);
    const button = required<HTMLButtonElement>(notice, '.dm-paste-feedback__cancel');
    button.focus();
    i18n.set({ locale: 'de', messages: deMessages });
    expect(document.activeElement).toBe(button);
    expect(required(notice, '.dm-paste-feedback__status').textContent).toBe('Bilder zum Einfügen werden vorbereitet.');
    expect(button.textContent).toBe('Abbrechen');
    expect(button.getAttribute('aria-label')).toBe('Bildvorbereitung abbrechen');
    const owner = document.implementation.createHTMLDocument('Adopted');
    owner.body.append(owner.adoptNode(dom));
    renderer.refresh();
    expect(notice.ownerDocument).toBe(owner);
    expect(dom.nextSibling).toBe(notice);
    expect(notice.hidden).toBe(false);
    button.click();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('keeps a newer pending presentation when localization synchronously replaces a terminal result', () => {
    const { renderer, notice, i18n } = fixture();
    const cancel = vi.fn();
    let replaced = false;
    i18n.set({ resolve: id => {
      if (!replaced && id === 'pasteCleanup.feedback.applied') {
        replaced = true;
        renderer.preparing('newer', cancel);
      }
      return undefined;
    } });
    renderer.update(result());
    expect(notice.dataset['status']).toBe('preparing');
    expect(required(notice, '.dm-paste-feedback__status').textContent).toBe('Preparing pasted images.');
    required<HTMLButtonElement>(notice, '.dm-paste-feedback__cancel').click();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('keeps a terminal result when localization replaces pending preparation', () => {
    const { renderer, notice, i18n } = fixture();
    const cancel = vi.fn();
    let replaced = false;
    i18n.set({ resolve: id => {
      if (!replaced && id === 'pasteCleanup.feedback.preparing') {
        replaced = true;
        renderer.update({ ...result('rejected', []), reason: 'target-changed' });
      }
      return undefined;
    } });
    renderer.preparing('older', cancel);
    expect(notice.dataset['status']).toBe('rejected');
    expect(required(notice, '.dm-paste-feedback__status').textContent).toBe('The paste destination changed.');
    expect(required(notice, '.dm-paste-feedback__cancel').hidden).toBe(true);
    required<HTMLButtonElement>(notice, '.dm-paste-feedback__cancel').click();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('bounds repeatedly reentrant host localization and hides inconsistent presentation', () => {
    const { renderer, notice, i18n } = fixture();
    let replacements = 0;
    i18n.set({ resolve: id => {
      if (id === 'pasteCleanup.feedback.preparing') {
        replacements++;
        renderer.preparing('reentrant', vi.fn());
      }
      return undefined;
    } });
    renderer.preparing('first', vi.fn());
    expect(replacements).toBe(4);
    expect(notice.hidden).toBe(true);
    expect(required(notice, '.dm-paste-feedback__status').textContent).toBe('');
  });

  it('clears cancellation and its listener on idempotent disposal, ignoring late preparation', () => {
    const { renderer, notice } = fixture();
    const cancel = vi.fn();
    renderer.preparing('pending', cancel);
    const button = required<HTMLButtonElement>(notice, '.dm-paste-feedback__cancel');
    renderer.dispose();
    renderer.dispose();
    renderer.preparing('late', cancel);
    button.click();
    expect(cancel).not.toHaveBeenCalled();
    expect(notice.parentNode).toBeNull();
  });

  it('starts hidden beside the editor, outside editable content, without a success message', () => {
    const { dom, notice } = fixture();
    expect(dom.nextSibling).toBe(notice);
    expect(dom.contains(notice)).toBe(false);
    expect(notice.hidden).toBe(true);
    expect(notice.contentEditable).toBe('false');
    expect(notice.getAttribute('role')).toBe('region');
    expect(notice.getAttribute('aria-label')).toBe('Paste notice');
    expect(required(notice, '.dm-paste-feedback__status').textContent).toBe('');
  });

  it.each(['applied', 'untracked', 'noop'] as const)('does not notify for a clean %s result or deliberate adaptation alone', status => {
    const { renderer, notice } = fixture();
    renderer.update(result(status, []));
    expect(notice.hidden).toBe(true);
    renderer.update({ status, diagnostics: [{ code: 'formatting-adapted', severity: 'info' }], diagnosticsTruncated: false });
    expect(notice.hidden).toBe(true);
    expect(required(notice, '.dm-paste-feedback__status').textContent).toBe('');
  });

  it('shows nonmodal image loss and actionable recovery without moving focus', () => {
    const { dom, renderer, notice } = fixture();
    dom.focus();
    const before = dom.textContent;
    renderer.update(result());
    expect(notice.hidden).toBe(false);
    expect(document.activeElement).toBe(dom);
    expect(dom.textContent).toBe(before);
    expect(notice.querySelector('[role="dialog"], [aria-modal], [autofocus]')).toBeNull();
    const status = required(notice, '.dm-paste-feedback__status');
    expect(status.textContent).toBe('Review the pasted content.');
    // The notice title is not a second live region; the announcer beside the notice speaks.
    expect(status.getAttribute('role')).toBeNull();
    expect(status.getAttribute('aria-live')).toBeNull();
    const recovery = required(notice, '.dm-paste-feedback__recovery');
    expect(recovery.hidden).toBe(false);
    expect(recovery.textContent).toContain('Paste missing images separately.');
    expect(recovery.textContent).toContain('If available, import the original DOCX file.');
  });

  it.each(['untracked', 'noop'] as const)('describes %s diagnostics without claiming a successful insertion', status => {
    const { renderer, notice } = fixture();
    renderer.update(result(status));
    expect(required(notice, '.dm-paste-feedback__status').textContent).toBe(status === 'untracked' ? 'Check the paste result.' : 'Paste made no changes.');
    expect(notice.dataset['status']).toBe(status);
  });

  it('shows rejection and recovery even when no diagnostic was recorded', () => {
    const { renderer, notice } = fixture();
    renderer.update(result('rejected', []));
    expect(notice.hidden).toBe(false);
    expect(required(notice, '.dm-paste-feedback__status').textContent).toBe('Paste was blocked.');
    expect(required(notice, '.dm-paste-feedback__recovery').textContent).toBe('Try a smaller selection or paste as plain text.');
    expect(required<HTMLDetailsElement>(notice, 'details').hidden).toBe(true);
  });

  it('lists warning and error reasons once and omits intentional adaptation information', () => {
    const { renderer, notice } = fixture();
    renderer.update({
      status: 'applied', diagnosticsTruncated: false,
      diagnostics: [
        { code: 'image-removed', severity: 'warning', offset: 123 },
        { code: 'image-removed', severity: 'error', offset: 456 },
        { code: 'link-removed', severity: 'warning' },
        { code: 'formatting-adapted', severity: 'info' },
      ],
    });
    expect(Array.from(notice.querySelectorAll('li'), node => node.textContent)).toEqual(['Some images could not be included.', 'Some links were removed.']);
    expect(notice.textContent).not.toMatch(/123|456|Formatting was adapted/);
  });

  it('lists adapted heading levels once however many headings moved, next to other destination findings', () => {
    const { renderer, notice } = fixture();
    renderer.update({
      status: 'applied', diagnosticsTruncated: false,
      diagnostics: [
        { code: 'destination-heading-level-adapted', severity: 'warning', offset: 0 },
        { code: 'destination-heading-level-adapted', severity: 'warning', offset: 20 },
        { code: 'destination-formatting-unconfirmed', severity: 'warning' },
      ],
    });
    expect(notice.hidden).toBe(false);
    expect(Array.from(notice.querySelectorAll('li'), node => node.textContent)).toEqual([
      'Some headings were changed to a heading level this editor supports.',
      'This editor may not preserve some pasted formatting.',
    ]);
  });

  it('provides native disclosure and button controls with keyboard dismissal', () => {
    const { renderer, notice } = fixture();
    renderer.update(result());
    const details = required<HTMLDetailsElement>(notice, 'details');
    const summary = required(notice, 'summary');
    expect(details.open).toBe(false);
    summary.click();
    expect(details.open).toBe(true);
    const dismiss = required<HTMLButtonElement>(notice, 'button');
    expect(dismiss.type).toBe('button');
    expect(dismiss.getAttribute('aria-label')).toBe('Dismiss paste notice');
    dismiss.focus();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    dismiss.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(notice.hidden).toBe(true);
  });

  it('does not consume navigation keys or Escape during composition', () => {
    const { renderer, notice } = fixture();
    renderer.update(result());
    for (const event of [new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true })]) {
      notice.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(notice.hidden).toBe(false);
    }
  });

  it('keeps dismissal through refresh and locale changes, then replaces it on the next result', () => {
    const { renderer, notice, i18n } = fixture();
    renderer.update(result());
    required<HTMLButtonElement>(notice, 'button').click();
    renderer.refresh();
    i18n.set({ locale: 'de' });
    expect(notice.hidden).toBe(true);
    renderer.update(result('applied', ['link-removed']));
    expect(notice.hidden).toBe(false);
    renderer.update(result('applied', []));
    expect(notice.hidden).toBe(true);
  });

  it('keeps unchanged live text and detail rows stable during ordinary view refreshes', () => {
    const { renderer, notice, i18n } = fixture();
    renderer.update(result());
    const status = required(notice, '.dm-paste-feedback__status');
    const text = status.firstChild;
    const row = required(notice, 'li');
    renderer.refresh();
    i18n.refresh();
    expect(status.firstChild).toBe(text);
    expect(required(notice, 'li')).toBe(row);
  });

  it('updates translated copy in place while retaining focus, disclosure and English fallback language', () => {
    const { renderer, notice, i18n } = fixture();
    renderer.update(result());
    const details = required<HTMLDetailsElement>(notice, 'details');
    details.open = true;
    const dismiss = required<HTMLButtonElement>(notice, 'button');
    dismiss.focus();
    i18n.set({ locale: 'de', messages: {
      'pasteCleanup.feedback.applied': 'Bitte den eingefügten Inhalt prüfen.',
      'pasteCleanup.feedback.dismiss': 'Schließen',
      'pasteCleanup.feedback.details': 'Einzelheiten',
    } });
    expect(required(notice, 'button')).toBe(dismiss);
    expect(document.activeElement).toBe(dismiss);
    expect(details.open).toBe(true);
    expect(required(notice, '.dm-paste-feedback__status').textContent).toBe('Bitte den eingefügten Inhalt prüfen.');
    expect(required(notice, '.dm-paste-feedback__status').lang).toBe('de');
    expect(required(notice, 'summary').textContent).toBe('Einzelheiten');
    expect(required(notice, 'li').lang).toBe('en');
    expect(dismiss.lang).toBe('en');
    expect(required(dismiss, 'span').lang).toBe('de');
  });

  it('keeps editor-local translations and notices isolated', () => {
    const first = fixture(new I18nService({ locale: 'en-GB', messages: { 'pasteCleanup.feedback.applied': 'Check the pasted content.' } }));
    const second = fixture();
    first.renderer.update(result());
    second.renderer.update(result('applied', ['link-removed']));
    expect(required(first.notice, '.dm-paste-feedback__status').textContent).toBe('Check the pasted content.');
    expect(required(second.notice, '.dm-paste-feedback__status').textContent).toBe('Review the pasted content.');
    required<HTMLButtonElement>(first.notice, 'button').click();
    expect(second.notice.hidden).toBe(false);
  });

  it('finishes with one consistent locale when a resolver replaces locale settings during a repaint', () => {
    const { renderer, notice, i18n } = fixture();
    renderer.update(result());
    let replaced = false;
    i18n.set({ locale: 'de', resolve: id => {
      if (!replaced && id === 'pasteCleanup.feedback.applied') {
        replaced = true;
        i18n.set({ locale: 'en-GB', messages: {
          'pasteCleanup.feedback.applied': 'Check the content.',
          'pasteCleanup.feedback.details': 'Additional details',
        } });
        return 'Veraltete Meldung';
      }
      return undefined;
    } });
    expect(required(notice, '.dm-paste-feedback__status').textContent).toBe('Check the content.');
    expect(required(notice, '.dm-paste-feedback__status').lang).toBe('en-GB');
    expect(required(notice, 'summary').textContent).toBe('Additional details');
  });

  it('renders translated text literally and never exposes unknown diagnostic content or source offsets', () => {
    const payload = '<img src="https://unsafe.test/a" onerror="alert(1)">';
    const { renderer, notice } = fixture(new I18nService({ messages: { 'pasteCleanup.feedback.applied': payload } }));
    renderer.update({ status: 'applied', diagnosticsTruncated: false,
      diagnostics: [{ code: payload, severity: 'warning', offset: 987654 }] as unknown as PasteDiagnostic[] });
    expect(required(notice, '.dm-paste-feedback__status').textContent).toBe(payload);
    expect(notice.querySelector('img, script, iframe')).toBeNull();
    expect(required(notice, 'li').textContent).toBe('Some pasted content may need review.');
    expect(required(notice, 'li').textContent).not.toContain(payload);
    expect(notice.textContent).not.toContain('987654');
  });

  it('bounds and deduplicates diagnostics while disclosing an incomplete list', () => {
    const { renderer, notice } = fixture();
    renderer.update({ status: 'applied', diagnosticsTruncated: false,
      diagnostics: Array.from({ length: 150 }, () => ({ code: 'image-removed', severity: 'warning' } as const)) });
    expect(notice.querySelectorAll('li')).toHaveLength(1);
    expect(required(notice, 'details > p').hidden).toBe(false);
    expect(required(notice, 'details > p').textContent).toBe('Not all paste details are shown.');
    renderer.update({ status: 'applied', diagnostics: [], diagnosticsTruncated: true });
    expect(notice.hidden).toBe(false);
    expect(notice.querySelectorAll('li')).toHaveLength(0);
  });

  it.each(['applied', 'untracked', 'noop'] as const)('stays quiet for a %s result whose truncated allowance retained only informational findings', status => {
    const { renderer, notice } = fixture();
    renderer.update({ status, diagnosticsTruncated: true,
      diagnostics: Array.from({ length: 100 }, () => ({ code: 'formatting-adapted', severity: 'info' } as const)) });
    expect(notice.hidden).toBe(true);
    expect(required(notice, '.dm-paste-feedback__status').textContent).toBe('');
  });

  it('omits the incomplete-list line when a retained informational finding proves no warning was dropped', () => {
    const { renderer, notice } = fixture();
    renderer.update({ status: 'applied', diagnosticsTruncated: true, diagnostics: [
      { code: 'unsupported-formatting', severity: 'warning' },
      ...Array.from({ length: 99 }, () => ({ code: 'formatting-adapted', severity: 'info' } as const)),
    ] });
    expect(notice.hidden).toBe(false);
    expect(Array.from(notice.querySelectorAll('li'), node => node.textContent)).toEqual(['Some formatting could not be preserved.']);
    expect(required(notice, 'details > p').hidden).toBe(true);
    renderer.update({ status: 'applied', diagnosticsTruncated: true,
      diagnostics: Array.from({ length: 100 }, () => ({ code: 'unsupported-formatting', severity: 'warning' } as const)) });
    expect(notice.hidden).toBe(false);
    expect(required(notice, 'details > p').hidden).toBe(false);
    expect(required(notice, 'details > p').textContent).toBe('Not all paste details are shown.');
  });

  it('snapshots diagnostic presentation without retaining a mutable result or source object', () => {
    const { renderer, notice, i18n } = fixture();
    const diagnostics: PasteDiagnostic[] = [{ code: 'image-removed', severity: 'warning' }];
    const input = { status: 'applied' as const, diagnostics, diagnosticsTruncated: false, html: '<p>Private content</p>' };
    renderer.update(input);
    diagnostics[0] = { code: 'link-removed', severity: 'warning' };
    i18n.refresh();
    expect(required(notice, 'li').textContent).toBe('Some images could not be included.');
    expect(notice.textContent).not.toContain('Private content');
  });

  it('uses the view ownerDocument even without global DOM objects', () => {
    const owner = document.implementation.createHTMLDocument('Owner');
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('window', undefined);
    const { renderer, notice } = fixture(new I18nService(), owner);
    renderer.update(result());
    expect(notice.ownerDocument).toBe(owner);
    expect(notice.querySelector('li')?.ownerDocument).toBe(owner);
  });

  it('mounts within the same shadow root and reattaches when the view moves or is adopted', () => {
    const shell = document.createElement('div');
    document.body.append(shell);
    cleanups.push(() => { shell.remove(); });
    const shadow = shell.attachShadow({ mode: 'open' });
    const { dom, renderer, notice, i18n } = fixture(new I18nService(), document, shadow);
    renderer.update(result());
    expect(notice.getRootNode()).toBe(shadow);
    const owner = document.implementation.createHTMLDocument('Adopted');
    owner.body.append(owner.adoptNode(dom));
    renderer.refresh();
    expect(dom.nextSibling).toBe(notice);
    expect(notice.ownerDocument).toBe(owner);
    i18n.refresh();
    expect(notice.querySelector('li')?.ownerDocument).toBe(owner);
    dom.remove();
    renderer.refresh();
    expect(notice.parentNode).toBeNull();
    owner.body.append(dom);
    renderer.refresh();
    expect(dom.nextSibling).toBe(notice);
  });

  it('detaches and unsubscribes exactly once, and ignores late updates after disposal', () => {
    const i18n = new I18nService();
    const unsubscribe = vi.fn();
    vi.spyOn(i18n, 'subscribe').mockReturnValue(unsubscribe);
    const { renderer, notice, host } = fixture(i18n);
    renderer.update(result());
    renderer.dispose();
    renderer.dispose();
    renderer.update(result('rejected'));
    renderer.refresh();
    i18n.refresh();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(notice.parentNode).toBeNull();
    expect(host.querySelector('.dm-paste-feedback')).toBeNull();
  });

  it('does not mutate an actual editor document, selection or transaction stream', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const transaction = vi.fn();
    const editor = new Editor({ element: host, extensions: [DocumentNode, Paragraph, Text], content: '<p>Authored text</p>', onTransaction: transaction });
    const renderer = createPasteFeedback(editor.view, editor.i18n);
    cleanups.push(() => { renderer.dispose(); editor.destroy(); host.remove(); });
    const state = editor.state;
    const selection = editor.state.selection.toJSON();
    const cancel = vi.fn();
    editor.view.focus();
    const focused = document.activeElement;
    renderer.preparing('pending', cancel);
    expect(document.activeElement).toBe(focused);
    required<HTMLButtonElement>(host, '.dm-paste-feedback__cancel').click();
    expect(document.activeElement).toBe(focused);
    expect(cancel).toHaveBeenCalledOnce();
    renderer.update(result());
    editor.i18n.set({ locale: 'de' });
    required<HTMLButtonElement>(host, '.dm-paste-feedback button').click();
    renderer.dispose();
    expect(editor.state).toBe(state);
    expect(editor.state.selection.toJSON()).toEqual(selection);
    expect(transaction).not.toHaveBeenCalled();
    expect(editor.getHTML()).toBe('<p>Authored text</p>');
  });

  it('owns immutable English definitions with no global registration', () => {
    for (const definition of Object.values(pasteCleanupMessages)) {
      expect(definition.owner).toBe('@domternal/extension-paste-cleanup');
      expect(Object.isFrozen(definition)).toBe(true);
      expect(definition.defaultValue).toEqual(expect.any(String));
      expect(definition.description.length).toBeGreaterThan(0);
    }
  });
});

describe('paste notice announcements and focus', () => {
  function announcer(host: HTMLElement): HTMLElement {
    return required(host, '.dm-paste-feedback__announcer');
  }

  it('keeps an empty polite live region in the tree beside the hidden notice before anything happens', () => {
    const { host, notice } = fixture();
    const region = announcer(host);
    expect(notice.contains(region)).toBe(false);
    expect(notice.nextSibling).toBe(region);
    expect(region.hidden).toBe(false);
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
    expect(region.textContent).toBe('');
    expect(region.style.position).toBe('absolute');
    expect(region.style.width).toBe('1px');
    expect(region.style.overflow).toBe('hidden');
  });

  it('announces a result, a blocked paste and preparation into the region that was already present', () => {
    const { host, renderer } = fixture();
    const region = announcer(host);
    renderer.update(result());
    expect(announcer(host)).toBe(region);
    expect(region.textContent).toBe('Review the pasted content.');
    renderer.update(result('rejected', []));
    expect(region.textContent).toBe('Paste was blocked.');
    renderer.preparing('pending', vi.fn());
    expect(region.textContent).toBe('Preparing pasted images.');
  });

  it('announces a repeated title again for a new operation, but not for a repaint of the same one', () => {
    const { host, renderer, i18n } = fixture();
    const region = announcer(host);
    renderer.update(result());
    const first = region.firstChild;
    renderer.refresh();
    i18n.refresh();
    expect(region.firstChild).toBe(first);
    renderer.update(result());
    expect(region.textContent).toBe('Review the pasted content.');
    expect(region.firstChild).not.toBe(first);
    renderer.update(result('rejected', []));
    const blocked = region.firstChild;
    renderer.update(result('rejected', []));
    expect(region.firstChild).not.toBe(blocked);
  });

  it('announces in the language of the message and clears the region when the notice hides', () => {
    const { host, renderer, notice, i18n } = fixture();
    renderer.update(result());
    i18n.set({ locale: 'de', messages: deMessages });
    expect(announcer(host).textContent).toBe(required(notice, '.dm-paste-feedback__status').textContent);
    expect(required(announcer(host), 'span').lang).toBe('de');
    required<HTMLButtonElement>(notice, '.dm-paste-feedback__dismiss').click();
    expect(announcer(host).textContent).toBe('');
    renderer.update(result('applied', []));
    expect(announcer(host).textContent).toBe('');
  });

  it('waits until a region inserted by an adoption has been in the tree before announcing', () => {
    vi.useFakeTimers();
    try {
      const i18n = new I18nService();
      const dom = document.createElement('div');
      const renderer = createPasteFeedback({ dom, focus: () => { dom.focus(); } }, i18n);
      const host = document.createElement('div');
      cleanups.push(() => { renderer.dispose(); i18n.destroy(); host.remove(); });
      renderer.update(result());
      vi.advanceTimersByTime(1000);
      document.body.append(host);
      host.append(dom);
      renderer.refresh();
      expect(announcer(host).textContent).toBe('');
      vi.advanceTimersByTime(50);
      expect(announcer(host).textContent).toBe('Review the pasted content.');
    } finally { vi.useRealTimers(); }
  });

  it.each(['click', 'enter-key', 'escape'] as const)('returns focus to the editor when the notice hides by %s while focus is in it', action => {
    const { dom, renderer, notice } = fixture();
    renderer.update(result());
    const dismiss = required<HTMLButtonElement>(notice, '.dm-paste-feedback__dismiss');
    const summary = required(notice, 'summary');
    if (action === 'escape') {
      summary.tabIndex = 0;
      summary.focus();
      expect(document.activeElement).toBe(summary);
      summary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    } else {
      dismiss.focus();
      expect(document.activeElement).toBe(dismiss);
      dismiss.click();
    }
    expect(notice.hidden).toBe(true);
    expect(document.activeElement).toBe(dom);
  });

  it('returns focus to the editor when a pointer press on Dismiss left focus on the page', () => {
    const { dom, renderer, notice } = fixture();
    renderer.update(result());
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    required<HTMLButtonElement>(notice, '.dm-paste-feedback__dismiss').click();
    expect(document.activeElement).toBe(dom);
  });

  it('leaves focus that another control holds where it is', () => {
    const { renderer, notice } = fixture();
    const input = document.createElement('input');
    document.body.append(input);
    cleanups.push(() => { input.remove(); });
    renderer.update(result());
    input.focus();
    required<HTMLButtonElement>(notice, '.dm-paste-feedback__dismiss').click();
    expect(document.activeElement).toBe(input);
    renderer.update(result());
    renderer.update(result('applied', []));
    expect(document.activeElement).toBe(input);
  });

  it('returns focus to the editor from Cancel, and when preparation ends while Cancel has focus', () => {
    const { dom, renderer, notice } = fixture();
    const cancelButton = required<HTMLButtonElement>(notice, '.dm-paste-feedback__cancel');
    renderer.preparing('first', vi.fn());
    cancelButton.focus();
    cancelButton.click();
    expect(notice.hidden).toBe(true);
    expect(document.activeElement).toBe(dom);

    renderer.preparing('second', vi.fn());
    cancelButton.focus();
    renderer.update(result('applied', []));
    expect(notice.hidden).toBe(true);
    expect(document.activeElement).toBe(dom);

    renderer.preparing('third', vi.fn());
    cancelButton.focus();
    renderer.update(result());
    expect(notice.hidden).toBe(false);
    expect(cancelButton.hidden).toBe(true);
    expect(document.activeElement).toBe(dom);
  });

  it('keeps focus on a control that stays visible when the notice repaints', () => {
    const { renderer, notice, i18n } = fixture();
    renderer.update(result());
    const dismiss = required<HTMLButtonElement>(notice, '.dm-paste-feedback__dismiss');
    dismiss.focus();
    renderer.update(result('rejected', []));
    i18n.set({ locale: 'de', messages: deMessages });
    expect(document.activeElement).toBe(dismiss);
  });
});
