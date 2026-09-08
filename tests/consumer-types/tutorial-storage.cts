import Core = require('@domternal/core');
import Highlight = require('@domternal/extension-code-block-lowlight');
import Toc = require('@domternal/extension-toc');

function createTutorialEditor(element: HTMLElement, lowlight: Highlight.Lowlight): Core.Editor {
  const editor = new Core.Editor({
    element,
    extensions: [Core.Document, Core.Paragraph, Core.Text, Core.Heading, Core.CharacterCount,
      Core.UniqueID.configure({ types: ['heading'] }), Toc.TableOfContents, Toc.TableOfContentsBlock,
      Highlight.CodeBlockLowlight.configure({ lowlight })],
  });
  const counts = editor.storage.characterCount as Core.CharacterCountStorage;
  const characters: number = counts.characters();
  const words: number = counts.words();
  const storage = editor.storage.codeBlock as Highlight.CodeBlockLowlightStorage;
  const languages: string[] = storage.listLanguages();
  const toc = editor.storage.toc as Toc.TocStorage;
  const active: string | null = toc.activeId;
  const dom: HTMLElement | null = toc.content[0]?.domNode ?? null;
  void [characters, words, languages, active, dom];
  editor.chain().insertContent({ type: 'tableOfContents' }).run();
  return editor;
}

function createPlainEditor(element: HTMLElement): Core.Editor {
  const editor = new Core.Editor({
    element, extensions: [Core.Document, Core.Paragraph, Core.Text, Core.CodeBlock],
  });
  // @ts-expect-error A package import cannot promise per-editor installation.
  editor.storage.codeBlock.listLanguages();
  return editor;
}

void [createTutorialEditor, createPlainEditor];
