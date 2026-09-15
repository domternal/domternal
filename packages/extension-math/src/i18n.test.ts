import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, Paragraph, Text } from '@domternal/core';
import { MathInline } from './MathInline.js';
import { MathBlock } from './MathBlock.js';
import { mathEditPluginKey } from './MathEditing.js';
import type { MathRenderer } from './renderer.js';

const editors: Editor[] = [];
const hosts: HTMLElement[] = [];
function createEditor(content: string, renderer: MathRenderer | null = null): Editor {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  const editor = new Editor({
    element: host, extensions: [Document, Paragraph, Text, MathInline.configure({ renderer }), MathBlock.configure({ renderer })], content,
  });
  editors.push(editor);
  return editor;
}
function open(editor: Editor, latex: string): { textarea: HTMLTextAreaElement; preview: HTMLElement; popover: HTMLElement } {
  editor.view.dispatch(editor.state.tr.setMeta(mathEditPluginKey, { pos: 1, latex, displayMode: false }));
  const popover = document.querySelector<HTMLElement>('.dm-math-popover[data-show]');
  const textarea = popover?.querySelector('textarea');
  const preview = popover?.querySelector<HTMLElement>('.dm-math-popover-preview');
  if (!popover || !textarea || !preview) throw new Error('Expected math source editor.');
  return { textarea, preview, popover };
}
afterEach(() => {
  editors.splice(0).forEach(editor => { editor.destroy(); });
  hosts.splice(0).forEach(host => { host.remove(); });
  vi.restoreAllMocks();
});

describe('math UI localization', () => {
  it('updates open source accessibility and preview copy while preserving a composing draft and selection', () => {
    const editor = createEditor('<p><span data-type="math-inline" data-latex="x^2"></span></p>');
    const { textarea, preview, popover } = open(editor, 'x^2');
    textarea.value = '\\frac{alpha}{beta}';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
    textarea.setSelectionRange(3, 7);
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const state = editor.state;
    const html = editor.getHTML();
    const transaction = vi.fn();
    editor.on('transaction', transaction);
    editor.i18n.set({ locale: 'hr', messages: { 'math.source.label': 'LaTeX izvor', 'math.preview.placeholder': '<b>Pregled</b>' } });
    expect(popover.hasAttribute('data-show')).toBe(true);
    expect(popover.querySelector('textarea')).toBe(textarea);
    expect(textarea.value).toBe('\\frac{alpha}{beta}');
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([3, 7]);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.getAttribute('aria-label')).toBe('LaTeX izvor');
    expect(textarea.lang).toBe('hr');
    expect(preview.getAttribute('data-placeholder')).toBe('<b>Pregled</b>');
    expect(preview.textContent).toBe('\\frac{alpha}{beta}');
    expect(preview.querySelector('b')).toBeNull();
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    expect(editor.state).toBe(state);
    expect(editor.getHTML()).toBe(html);
    expect(transaction).not.toHaveBeenCalled();
    expect(popover.hasAttribute('data-show')).toBe(true);
  });

  it('localizes empty equations and preview without serializing placeholders or changing LaTeX', () => {
    const editor = createEditor('<p><span data-type="math-inline"></span></p><div data-type="math-block"></div>');
    const { textarea, preview } = open(editor, '');
    const html = editor.getHTML();
    const json = editor.getJSON();
    const state = editor.state;
    const nodes = Array.from(editor.view.dom.querySelectorAll('.dm-math-empty'));
    editor.i18n.set({ locale: 'hr', messages: { 'math.empty': '<b>Nova jednadžba</b>', 'math.preview.placeholder': 'Pregled' } });
    expect(nodes.map(node => node.textContent)).toEqual(['<b>Nova jednadžba</b>', '<b>Nova jednadžba</b>']);
    expect(nodes.every(node => node.getAttribute('lang') === 'hr')).toBe(true);
    expect(editor.view.dom.querySelector('.dm-math b')).toBeNull();
    expect(preview.getAttribute('data-placeholder')).toBe('Pregled');
    expect(preview.lang).toBe('hr');
    expect(textarea.value).toBe('');
    expect(editor.state).toBe(state);
    expect(editor.getHTML()).toBe(html);
    expect(editor.getJSON()).toEqual(json);
  });

  it('does not re-render nonempty math or localize its technical source', () => {
    const renderToString = vi.fn((latex: string) => `<em>${latex}</em>`);
    const editor = createEditor('<p><span data-type="math-inline" data-latex="x^2"></span></p>', { renderToString });
    const formula = editor.view.dom.querySelector('.dm-math em');
    renderToString.mockClear();
    editor.i18n.set({ locale: 'hr', messages: { 'math.empty': 'Nova jednadžba' } });
    expect(editor.view.dom.querySelector('.dm-math em')).toBe(formula);
    expect(formula?.textContent).toBe('x^2');
    expect(renderToString).not.toHaveBeenCalled();
  });

  it('localizes insertion items while retaining stable commands, groups and technical aliases', () => {
    const editor = createEditor('<p></p>');
    editor.i18n.set({ locale: 'hr', messages: {
      'math.inline.label': 'Redna jednadžba', 'math.inline.description': '', 'math.block.label': 'Jednadžba',
      'core.group.advanced': 'Napredno',
    }, searchAliases: { 'math.inline.label': ['formula-u-retku'] } });
    expect(editor.toolbarItems.find(item => item.name === 'mathInline')).toMatchObject({ label: 'Redna jednadžba', command: 'insertMathInline', group: 'insert' });
    expect(editor.floatingMenuItems.find(item => item.name === 'mathInline')).toMatchObject({
      label: 'Redna jednadžba', labelLanguage: 'hr', description: '', group: 'Advanced', groupLabel: 'Napredno',
      keywords: ['formula-u-retku', 'math', 'latex', 'equation', 'formula', 'inline'],
    });
    expect(editor.floatingMenuItems.find(item => item.name === 'mathBlock')).toMatchObject({ label: 'Jednadžba', command: 'insertMathBlock' });
  });

  it('isolates instances and releases popover and node view subscriptions', () => {
    const first = createEditor('<p><span data-type="math-inline"></span></p>');
    const second = createEditor('<p><span data-type="math-inline"></span></p>');
    const node = first.view.dom.querySelector('.dm-math');
    const popover = document.querySelector<HTMLElement>('.dm-math-popover');
    first.i18n.set({ locale: 'hr', messages: { 'math.empty': 'Nova jednadžba', 'math.source.label': 'Izvor' } });
    expect(second.view.dom.querySelector('.dm-math')?.textContent).toBe('New equation');
    first.destroy();
    first.i18n.set({ locale: 'de' });
    expect(node?.textContent).toBe('Nova jednadžba');
    expect(popover?.querySelector('textarea')?.getAttribute('aria-label')).toBe('Izvor');
    expect(popover?.isConnected).toBe(false);
  });
});
