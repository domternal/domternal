import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, I18nService, StarterKit } from '@domternal/core';
import { createPasteFeedback } from './feedback.js';
import type { PasteFeedbackRenderer, PasteFeedbackResult } from './feedback.js';
import { PasteCleanup } from './PasteCleanup.js';
import type { PasteCleanupOptions } from './PasteCleanup.js';
import { deMessages } from './locales/de.js';

const dispose: (() => void)[] = [];
afterEach(() => { dispose.splice(0).reverse().forEach(run => { run(); }); vi.restoreAllMocks(); });
function mount(parent: HTMLElement | ShadowRoot = document.body): {
  host: HTMLDivElement; dom: HTMLDivElement; i18n: I18nService; focus: ReturnType<typeof vi.fn>;
  renderer: PasteFeedbackRenderer; notice: HTMLElement; announcer: HTMLElement;
} {
  const host = document.createElement('div'); parent.append(host);
  const dom = document.createElement('div'); dom.tabIndex = 0; host.append(dom);
  const i18n = new I18nService(); const focus = vi.fn(() => { dom.focus(); });
  const renderer = createPasteFeedback({ dom, focus }, i18n);
  const notice = host.querySelector<HTMLElement>('.dm-paste-feedback')!;
  const announcer = host.querySelector<HTMLElement>('.dm-paste-feedback__announcer')!;
  dispose.push(() => { renderer.dispose(); i18n.destroy(); host.remove(); });
  return { host, dom, i18n, focus, renderer, notice, announcer };
}
const result = (status: PasteFeedbackResult['status'], operationId = 'one'): PasteFeedbackResult => ({
  operationId, status, diagnostics: [], diagnosticsTruncated: false,
});

describe('accessible paste lifecycle', () => {
  it('announces a clean accepted image preparation once without showing a warning', () => {
    const f = mount(); f.renderer.preparing('one', vi.fn());
    f.renderer.update(result('applied'));
    expect(f.notice.hidden).toBe(true);
    expect(f.announcer.textContent).toBe('Images pasted.');
    const announcement = f.announcer.firstChild;
    f.renderer.refresh(); f.renderer.update(result('applied'));
    expect(f.announcer.firstChild).toBe(announcement);
    expect(f.focus).not.toHaveBeenCalled();
  });
  it.each(['untracked', 'noop', 'rejected'] as const)('never announces successful completion for %s', status => {
    const f = mount(); f.renderer.preparing('one', vi.fn()); f.renderer.update(result(status));
    expect(f.announcer.textContent).not.toBe('Images pasted.');
  });
  it('does not complete a newer operation with an obsolete result', () => {
    const f = mount(); f.renderer.preparing('two', vi.fn()); f.renderer.update(result('applied', 'one'));
    expect(f.notice.dataset['status']).toBe('preparing');
    expect(f.announcer.textContent).toBe('Preparing pasted images.');
    f.renderer.update(result('applied', 'two')); expect(f.announcer.textContent).toBe('Images pasted.');
  });
  it('keeps ordinary clean pastes silent and clears completion for the next operation', () => {
    const f = mount(); f.renderer.update(result('applied')); expect(f.announcer.textContent).toBe('');
    f.renderer.preparing('two', vi.fn()); f.renderer.update(result('applied', 'two'));
    f.renderer.update(result('applied', 'three')); expect(f.announcer.textContent).toBe('');
  });
  it('announces completion in German even if the pending notice was dismissed', () => {
    const f = mount(); f.i18n.set({ locale: 'de', messages: deMessages }); f.renderer.preparing('one', vi.fn());
    f.notice.querySelector<HTMLButtonElement>('button')!.click(); f.renderer.update(result('applied'));
    expect(f.notice.hidden).toBe(true); expect(f.announcer.textContent).toBe('Bilder eingefügt.');
    expect(f.announcer.firstElementChild?.getAttribute('lang')).toBe('de');
  });
  it('moves focus only to a visible notice and Escape returns to the editor', () => {
    const f = mount(); expect(f.renderer.focus()).toBe(false);
    f.renderer.preparing('one', vi.fn()); f.dom.focus();
    expect(f.renderer.focus()).toBe(true); expect(f.notice.contains(document.activeElement)).toBe(true);
    f.notice.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(f.dom); expect(f.renderer.focus()).toBe(false);
  });
  it('uses a named group instead of adding a landmark for every editor', () => {
    const first = mount(); const second = mount();
    first.dom.setAttribute('aria-label', 'Article'); second.dom.setAttribute('aria-label', 'Reply');
    first.renderer.preparing('one', vi.fn()); second.renderer.preparing('two', vi.fn());
    expect(first.notice.getAttribute('role')).toBe('group');
    expect(first.notice.getAttribute('aria-label')).toBe('Paste notice: Article');
    expect(second.notice.getAttribute('aria-label')).toBe('Paste notice: Reply');
    first.dom.setAttribute('aria-label', 'Renamed'); first.renderer.refresh();
    expect(first.notice.getAttribute('aria-label')).toBe('Paste notice: Renamed');
  });
  it('follows valid labelledby references in the editor root without interpolating their markup', () => {
    const f = mount(); const label = document.createElement('span'); label.id = 'feedback-owner-title'; label.textContent = 'Article'; f.host.prepend(label);
    f.dom.setAttribute('aria-labelledby', `${label.id} missing-label`); f.dom.setAttribute('aria-label', 'Ignored');
    f.renderer.preparing('one', vi.fn());
    const references = f.notice.getAttribute('aria-labelledby')?.split(' ') ?? [];
    expect(references).toHaveLength(2); expect(references[1]).toBe(label.id);
    expect(document.getElementById(references[0]!)?.textContent).toBe('Paste notice');
    expect(f.notice.hasAttribute('aria-label')).toBe(false);
    label.remove(); f.renderer.refresh(); expect(f.notice.getAttribute('aria-label')).toBe('Paste notice: Ignored');
  });
  it('resolves editor labels inside a shadow root and uses a generic name for an unnamed editor', () => {
    const host = document.createElement('div'); document.body.append(host); dispose.push(() => { host.remove(); });
    const shadow = host.attachShadow({ mode: 'open' }); const f = mount(shadow);
    const label = document.createElement('span'); label.id = 'shadow-title'; label.textContent = 'Reply'; shadow.prepend(label);
    f.dom.setAttribute('aria-labelledby', label.id); f.renderer.preparing('one', vi.fn());
    expect(f.notice.getAttribute('aria-labelledby')).toContain('shadow-title');
    f.dom.removeAttribute('aria-labelledby'); f.renderer.refresh();
    expect(f.notice.getAttribute('aria-label')).toBe('Paste notice'); expect(f.notice.hasAttribute('aria-labelledby')).toBe(false);
  });
  it('repairs label ID collisions and resolves the new owner after document adoption', () => {
    const f = mount(); const label = document.createElement('span'); label.id = 'adopted-title'; label.textContent = 'Old';
    document.body.append(label); dispose.push(() => { label.remove(); });
    f.dom.setAttribute('aria-labelledby', label.id); f.renderer.preparing('one', vi.fn());
    const originalId = f.notice.getAttribute('aria-labelledby')!.split(' ')[0]!;
    const target = document.implementation.createHTMLDocument();
    const collision = target.createElement('span'); collision.id = originalId; collision.textContent = 'Unrelated';
    const newLabel = target.createElement('span'); newLabel.id = label.id; newLabel.textContent = 'New';
    target.body.append(collision, newLabel, target.adoptNode(f.host));
    f.renderer.refresh();
    const ids = f.notice.getAttribute('aria-labelledby')!.split(' ');
    expect(ids[0]).not.toBe(originalId); expect(ids[1]).toBe(label.id);
    expect(target.getElementById(ids[0]!)?.textContent).toBe('Paste notice');
    expect(target.getElementById(ids[1]!)?.textContent).toBe('New');
    expect(collision.textContent).toBe('Unrelated');
  });
});


describe('paste feedback keyboard access', () => {
  async function editorFixture(options: PasteCleanupOptions = {}): Promise<Editor> {
    const host = document.body.appendChild(document.createElement('div'));
    const editor = new Editor({ element: host, extensions: [StarterKit, PasteCleanup.configure(options)],
      content: '<ul><li><p>First</p></li><li><p>Second</p></li></ul>' });
    editor.view.setProps({ handleScrollToSelection: () => true });
    dispose.push(() => { editor.destroy(); host.remove(); });
    editor.commands.focus('end'); editor.view.pasteHTML('<p>New<script>private</script></p>', new Event('paste') as ClipboardEvent);
    await vi.waitFor(() => { expect(host.parentElement?.querySelector('.dm-paste-feedback:not([hidden])')).not.toBeNull(); });
    return editor;
  }
  function press(editor: Editor, init: KeyboardEventInit): boolean {
    return editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  }
  it('keeps Tab indentation, provides notice access and restores the stored selection on Escape', async () => {
    const editor = await editorFixture(); const before = editor.state.doc;
    press(editor, { key: 'Tab', keyCode: 9 }); expect(editor.state.doc.eq(before)).toBe(false);
    const snapshot = { doc: editor.getJSON(), selection: editor.state.selection.toJSON() };
    expect(press(editor, { key: 'P', keyCode: 80, altKey: true, shiftKey: true })).toBe(false);
    const notice = editor.view.dom.parentElement!.querySelector<HTMLElement>('.dm-paste-feedback')!;
    expect(notice.contains(document.activeElement)).toBe(true);
    notice.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(editor.view.dom);
    expect({ doc: editor.getJSON(), selection: editor.state.selection.toJSON() }).toEqual(snapshot);
    expect(press(editor, { key: 'P', keyCode: 80, altKey: true, shiftKey: true })).toBe(true);
  });
  it('supports a host shortcut and ignores composition, unrelated modifiers and a disabled shortcut', async () => {
    const editor = await editorFixture({ focusFeedbackShortcut: 'Alt-F9' });
    expect(press(editor, { key: 'P', keyCode: 80, altKey: true, shiftKey: true })).toBe(true);
    expect(press(editor, { key: 'F9', altKey: true, isComposing: true })).toBe(true);
    expect(press(editor, { key: 'F9', altKey: true, ctrlKey: true })).toBe(true);
    expect(press(editor, { key: 'F9', altKey: true })).toBe(false);
    const disabled = await editorFixture({ focusFeedbackShortcut: false });
    expect(press(disabled, { key: 'P', keyCode: 80, altKey: true, shiftKey: true })).toBe(true);
  });
  it.each(['', ' ', 4, null, 'UnknownModifier-P'])('refuses invalid shortcut configuration %j', shortcut => {
    expect(() => new Editor({ extensions: [StarterKit, PasteCleanup.configure({ focusFeedbackShortcut: shortcut as string })] }))
      .toThrow(/PasteCleanup: .*focusFeedbackShortcut/u);
  });
});
