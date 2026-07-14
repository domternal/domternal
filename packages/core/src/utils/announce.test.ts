import { describe, it, expect } from 'vitest';
import { announce } from './announce.js';

function makeEditor(): { view: { dom: Element }; editorEl: HTMLElement } {
  const editorEl = document.createElement('div');
  editorEl.className = 'dm-editor';
  const dom = document.createElement('div');
  editorEl.appendChild(dom);
  return { view: { dom }, editorEl };
}

describe('announce', () => {
  it('lazily creates one polite status region inside .dm-editor', () => {
    const { view, editorEl } = makeEditor();

    announce(view, 'Moved to column 2 of 3');

    const region = editorEl.querySelector('.dm-live-region');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.hasAttribute('data-dm-editor-ui')).toBe(true);
    expect(region?.textContent).toBe('Moved to column 2 of 3');
  });

  it('reuses the region across calls instead of stacking new ones', () => {
    const { view, editorEl } = makeEditor();

    announce(view, 'first');
    announce(view, 'second');

    expect(editorEl.querySelectorAll('.dm-live-region')).toHaveLength(1);
    expect(editorEl.querySelector('.dm-live-region')?.textContent).toBe('second');
  });

  it('mutates the DOM even for a repeated identical message', () => {
    const { view, editorEl } = makeEditor();

    announce(view, 'same');
    const first = editorEl.querySelector('.dm-live-region')?.textContent;
    announce(view, 'same');
    const second = editorEl.querySelector('.dm-live-region')?.textContent;

    expect(first).toBe('same');
    expect(second).not.toBe(first);
    expect(second?.trimEnd()).toBe('same');
  });

  it('is a no-op without a .dm-editor ancestor', () => {
    const dom = document.createElement('div');
    document.body.appendChild(dom);
    expect(() => { announce({ dom }, 'nothing'); }).not.toThrow();
    expect(document.querySelector('.dm-live-region')).toBeNull();
    dom.remove();
  });
});
