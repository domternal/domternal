import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from './Editor.js';
import { Document } from './nodes/Document.js';
import { Paragraph } from './nodes/Paragraph.js';
import { Text } from './nodes/Text.js';
import type { I18nOptions } from './i18n/index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

describe('reentrant editor UI repaint', () => {
  it.each(['resolver', 'message', 'diagnostic'] as const)(
    'keeps the newest accessible name after a %s changes the locale during repaint',
    source => {
      const editor = new Editor({ extensions: [Document, Paragraph, Text], content: '<p>Hello</p>' });
      editors.push(editor);
      editor.view.dom.lang = 'fr';
      const state = editor.state;
      const view = editor.view;
      const transaction = vi.fn();
      editor.on('transaction', transaction);
      let changed = false;
      const replace = (): void => {
        if (changed) return;
        changed = true;
        editor.i18n.set({ locale: 'de', messages: { 'core.editor.label': 'Texteditor' } });
      };
      const options: I18nOptions = source === 'resolver'
        ? { locale: 'hr', resolve: id => {
          if (id !== 'core.editor.label') return undefined;
          replace();
          return 'Stale Croatian wording';
        } }
        : source === 'message'
          ? { locale: 'hr', messages: { 'core.editor.label': () => {
            replace();
            return 'Stale Croatian wording';
          } } }
          : { locale: 'hr', messages: { 'core.editor.label': '' }, onDiagnostic: replace };
      editor.i18n.set(options);
      expect(changed).toBe(true);
      expect(editor.i18n.getSnapshot().locale).toBe('de');
      expect(editor.view.dom.getAttribute('aria-label')).toBe('Texteditor');
      expect(editor.view.dom.lang).toBe('fr');
      expect(editor.view).toBe(view);
      expect(editor.state).toBe(state);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});
