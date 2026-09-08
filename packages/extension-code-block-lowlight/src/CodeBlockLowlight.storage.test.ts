import { afterEach, describe, expect, it } from 'vitest';
import { Editor, Document, Paragraph, Text, CodeBlock } from '@domternal/core';
import type { DecorationSet } from '@domternal/pm/view';
import { createLowlight, common } from 'lowlight';
import { CodeBlockLowlight, type CodeBlockLowlightStorage } from './CodeBlockLowlight.js';
import { lowlightPluginKey } from './lowlightPlugin.js';

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe('Lowlight storage and saved language aliases', () => {
  it.each(['ts', 'project-ts', 'unavailable-language'])(
    'preserves %s through HTML and JSON reloads while highlighting supported aliases',
    (language) => {
      const lowlight = createLowlight(common);
      lowlight.registerAlias({ typescript: ['project-ts'] });
      const editor = new Editor({
        extensions: [Document, Paragraph, Text, CodeBlockLowlight.configure({ lowlight, autoDetect: false })],
        content: `<pre><code class="language-${language}">const count: number = 1;</code></pre>`,
      });
      editors.push(editor);
      const storage = editor.storage['codeBlock'] as CodeBlockLowlightStorage;
      expect(storage.listLanguages()).toContain('typescript');
      expect(storage.listLanguages()).not.toContain(language);
      expect(editor.storage['codeBlockLowlight']).toBeUndefined();
      const supported = language !== 'unavailable-language';
      expect(lowlight.registered(language)).toBe(supported);

      const expectSavedLanguage = (): void => {
        expect(editor.state.doc.firstChild?.type.name).toBe('codeBlock');
        expect(editor.state.doc.firstChild?.attrs['language']).toBe(language);
        expect(editor.getHTML()).toContain(`class="language-${language}"`);
        const decorations = lowlightPluginKey.getState(editor.state) as DecorationSet;
        expect(decorations.find().length > 0).toBe(supported);
      };
      expectSavedLanguage();
      editor.setContent(editor.getHTML());
      expectSavedLanguage();
      editor.setContent(editor.getJSON());
      expectSavedLanguage();
      expect(editor.storage['codeBlock']).toBe(storage);
    },
  );

  it('exposes the language capability only on editors that install Lowlight', () => {
    const lowlight = createLowlight(common);
    const plain = new Editor({ extensions: [Document, Paragraph, Text, CodeBlock] });
    const highlighted = new Editor({
      extensions: [Document, Paragraph, Text, CodeBlockLowlight.configure({ lowlight })],
    });
    editors.push(plain, highlighted);
    const languages = (editor: Editor): string[] => {
      const storage = editor.storage['codeBlock'];
      if (typeof storage !== 'object' || storage === null || !('listLanguages' in storage)
        || typeof storage.listLanguages !== 'function') return [];
      return (storage as CodeBlockLowlightStorage).listLanguages();
    };
    expect(languages(plain)).toEqual([]);
    expect(languages(highlighted)).toContain('typescript');
    expect(plain.storage['codeBlockLowlight']).toBeUndefined();
    expect(highlighted.storage['codeBlockLowlight']).toBeUndefined();
  });
});
