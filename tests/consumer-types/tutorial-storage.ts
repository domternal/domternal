import {
  Editor, Document, Paragraph, Text, Heading, CodeBlock, CharacterCount, UniqueID, Extension,
  type CharacterCountStorage,
} from '@domternal/core';
import {
  CodeBlockLowlight, type CodeBlockLowlightStorage, type Lowlight,
} from '@domternal/extension-code-block-lowlight';
import { TableOfContents, TableOfContentsBlock, type TocStorage } from '@domternal/extension-toc';

// These examples use the public declaration entry points, with both CodeBlock
// implementations imported into the same program and configured per editor.
export function createTutorialEditor(element: HTMLElement, lowlight: Lowlight): Editor {
  const editor = new Editor({
    element,
    extensions: [Document, Paragraph, Text, Heading, CharacterCount,
      UniqueID.configure({ types: ['heading'] }), TableOfContents, TableOfContentsBlock,
      CodeBlockLowlight.configure({ lowlight })],
    content: '<h2>Example</h2><p>Text</p>',
  });
  const counts = editor.storage.characterCount as CharacterCountStorage;
  const characters: number = counts.characters();
  const words: number = counts.words();
  const highlight = editor.storage.codeBlock as CodeBlockLowlightStorage;
  const languages: string[] = highlight.listLanguages();
  const toc = editor.storage.toc as TocStorage;
  const activeId: string | null = toc.activeId;
  const dom: HTMLElement | null = toc.content[0]?.domNode ?? null;
  void [characters, words, languages, activeId, dom];
  editor.chain().insertContent({ type: 'tableOfContents' }).run();
  return editor;
}

export function optionalLanguageCapability(editor: Editor): string[] {
  const storage = editor.storage.codeBlock;
  if (typeof storage !== 'object' || storage === null || !('listLanguages' in storage)
    || typeof storage.listLanguages !== 'function') return [];
  return (storage as CodeBlockLowlightStorage).listLanguages();
}

export function createPlainEditor(element: HTMLElement): Editor {
  const editor = new Editor({ element, extensions: [Document, Paragraph, Text, CodeBlock] });
  // Importing Lowlight above does not prove that this editor installed it.
  // @ts-expect-error Storage stays unknown until narrowed to an installed capability.
  editor.storage.codeBlock.listLanguages();
  // @ts-expect-error An arbitrary extension key must not silently become any.
  editor.storage.notInstalled.value();
  return editor;
}

export const TutorialStorage = Extension.create<Record<string, never>, { updates: number }>({
  name: 'tutorialStorage',
  addStorage() { return { updates: 0 }; },
  onCreate() {
    const updates: number = this.storage.updates;
    this.storage.updates = updates + 1;
    // @ts-expect-error The second generic determines storage member types.
    this.storage.updates = 'invalid';
  },
});

export function getLanguageOptions(lowlight: Lowlight, currentLanguage: string | null): { value: string; label: string }[] {
  const names = lowlight.listLanguages().sort();
  const options = [
    { value: '', label: 'No explicit language' },
    ...names.map((name) => ({ value: name, label: name })),
  ];
  if (currentLanguage && !names.includes(currentLanguage)) {
    const status = lowlight.registered(currentLanguage) ? 'alias' : 'unavailable';
    options.push({ value: currentLanguage, label: `${currentLanguage} (${status})` });
  }
  return options;
}
