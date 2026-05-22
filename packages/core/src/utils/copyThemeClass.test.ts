import { describe, it, expect } from 'vitest';
import { copyThemeClass } from './copyThemeClass.js';

function makeView(dom: Element) {
  return { dom };
}

describe('copyThemeClass', () => {
  it('copies dm-theme-* from a dm-theme-* ancestor to the target', () => {
    const root = document.createElement('div');
    root.className = 'dm-theme-dark';
    const editorDom = document.createElement('div');
    root.appendChild(editorDom);
    const target = document.createElement('div');

    copyThemeClass(makeView(editorDom), target);

    expect(target.classList.contains('dm-theme-dark')).toBe(true);
  });

  it('falls back to .dm-editor when no dm-theme-* ancestor exists', () => {
    const editor = document.createElement('div');
    editor.className = 'dm-editor dm-theme-auto';
    const editorDom = document.createElement('div');
    editor.appendChild(editorDom);
    const target = document.createElement('div');

    copyThemeClass(makeView(editorDom), target);

    expect(target.classList.contains('dm-theme-auto')).toBe(true);
  });

  it('removes stale dm-theme-* classes before copying', () => {
    const root = document.createElement('div');
    root.className = 'dm-theme-dark';
    const editorDom = document.createElement('div');
    root.appendChild(editorDom);
    const target = document.createElement('div');
    target.classList.add('dm-theme-light', 'unrelated');

    copyThemeClass(makeView(editorDom), target);

    expect(target.classList.contains('dm-theme-light')).toBe(false);
    expect(target.classList.contains('dm-theme-dark')).toBe(true);
    expect(target.classList.contains('unrelated')).toBe(true);
  });

  it('does nothing visible when no source ancestor is found', () => {
    const orphan = document.createElement('div');
    const target = document.createElement('div');
    target.className = 'kept';

    copyThemeClass(makeView(orphan), target);

    expect(target.className).toBe('kept');
  });

  it('still clears stale theme classes even when no source ancestor exists', () => {
    const orphan = document.createElement('div');
    const target = document.createElement('div');
    target.classList.add('dm-theme-dark', 'kept');

    copyThemeClass(makeView(orphan), target);

    expect(target.classList.contains('dm-theme-dark')).toBe(false);
    expect(target.classList.contains('kept')).toBe(true);
  });
});
