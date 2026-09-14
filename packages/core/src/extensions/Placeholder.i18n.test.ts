import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Bold } from '../marks/Bold.js';
import { Placeholder } from './Placeholder.js';

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});
function create(extension = Placeholder): Editor {
  const editor = new Editor({ extensions: [Document, Text, Paragraph, Bold, extension] });
  editors.push(editor);
  return editor;
}

describe('placeholder localization', () => {
  it('updates plain text decorations without transactions, document changes or new DOM', () => {
    const editor = create();
    const paragraph = editor.view.dom.querySelector('p');
    const state = editor.state;
    const onTransaction = vi.fn();
    editor.on('transaction', onTransaction);
    editor.i18n.set({
      locale: 'hr',
      messages: { 'core.placeholder.default': '<img src=x> Pišite' },
    });
    expect(editor.view.dom.querySelector('p')).toBe(paragraph);
    expect(paragraph?.getAttribute('data-placeholder')).toBe('<img src=x> Pišite');
    expect(paragraph?.querySelector('img')).toBeNull();
    expect(paragraph?.getAttribute('lang')).toBeNull();
    expect(editor.state).toBe(state);
    expect(onTransaction).not.toHaveBeenCalled();
    editor.i18n.set();
    expect(paragraph?.getAttribute('data-placeholder')).toBe('Write something …');
    editor.i18n.set({ messages: { 'core.placeholder.default': '' } });
    expect(paragraph?.getAttribute('data-placeholder')).toBe('');
  });

  it('preserves explicit English defaults and consumer placeholder functions', () => {
    const explicit = create(Placeholder.configure({ placeholder: 'Write something …' }));
    const custom = create(Placeholder.configure({ placeholder: () => 'Consumer text' }));
    const extended = create(
      Placeholder.extend({
        addOptions() {
          return { ...Placeholder.options, placeholder: 'Write something …' };
        },
      })
    );
    for (const editor of [explicit, custom, extended]) {
      editor.i18n.set({ locale: 'hr', messages: { 'core.placeholder.default': 'Pišite' } });
    }
    expect(explicit.view.dom.querySelector('p')?.getAttribute('data-placeholder')).toBe(
      'Write something …'
    );
    expect(extended.view.dom.querySelector('p')?.getAttribute('data-placeholder')).toBe(
      'Write something …'
    );
    expect(custom.view.dom.querySelector('p')?.getAttribute('data-placeholder')).toBe(
      'Consumer text'
    );
  });

  it('defers a repaint until composition ends without clearing stored marks', async () => {
    const editor = create();
    editor.view.dispatch(editor.state.tr.setStoredMarks([editor.schema.marks['bold']!.create()]));
    const state = editor.state;
    const paragraph = editor.view.dom.querySelector('p');
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(editor.view.composing).toBe(true);
    editor.i18n.set({ locale: 'hr', messages: { 'core.placeholder.default': 'Pišite' } });
    expect(editor.view.composing).toBe(true);
    expect(paragraph?.getAttribute('data-placeholder')).toBe('Write something …');
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(paragraph?.getAttribute('data-placeholder')).toBe('Pišite');
    expect(editor.view.dom.querySelector('p')).toBe(paragraph);
    expect(editor.state).toBe(state);
  });

  it('cancels a queued repaint when the editor is destroyed', async () => {
    const editor = create();
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    editor.i18n.set({ locale: 'hr', messages: { 'core.placeholder.default': 'Pišite' } });
    const setProps = vi.spyOn(editor.view, 'setProps');
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    editor.destroy();
    await Promise.resolve();
    await Promise.resolve();
    expect(setProps).not.toHaveBeenCalled();
  });
});
