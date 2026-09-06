/**
 * Markdown extension: bidirectional Markdown for the editor. Parsing and
 * serialization are also available headlessly through createMarkdownParser
 * and createMarkdownSerializer; the extension wires them to commands, paste,
 * and a shared storage other packages can reuse.
 */
import { Extension } from '@domternal/core';
import type { CommandSpec, Editor, JSONContent, SetContentOptions } from '@domternal/core';
import type { Schema } from '@domternal/pm/model';
import { createMarkdownParser } from './parser/parser.js';
import type { MarkdownParser } from './parser/parser.js';
import { markdownPastePlugin } from './pastePlugin.js';
import { createMarkdownSerializer } from './serializer/serializer.js';
import type {
  MarkdownSerializer,
  MarkdownSerializerSpecOverrides,
} from './serializer/serializer.js';
import type { SerializeMarkdownResult } from './types.js';

declare module '@domternal/core' {
  interface RawCommands {
    insertMarkdown: CommandSpec<[markdown: string]>;
    setMarkdownContent: CommandSpec<[markdown: string, options?: SetContentOptions]>;
  }
}

export interface MarkdownOptions {
  /**
   * Convert Markdown-looking plain-text pastes into rich content. Pastes
   * with matching source-formatting HTML convert too. Rich HTML, plain prose,
   * and pastes into code blocks are never touched.
   * @default true
   */
  paste: boolean;

  /**
   * Serialize lists without blank lines between items.
   * @default true
   */
  tightLists: boolean;

  /**
   * Extra or replacement Markdown mappings for custom nodes and marks,
   * merged over the built-in ones.
   * @default null
   */
  specs: MarkdownSerializerSpecOverrides | null;
}

export interface MarkdownStorage {
  /** Shared parser instance; built on editor create, reusable by other packages. */
  parser: MarkdownParser | null;
  /** Shared serializer instance; built on editor create, reusable by other packages. */
  serializer: MarkdownSerializer | null;
}

/** Serialize the editor's current document to Markdown. */
export function getMarkdown(editor: Editor): SerializeMarkdownResult {
  const storage = editor.storage['markdown'] as MarkdownStorage | undefined;
  const serializer = storage?.serializer ?? createMarkdownSerializer();
  return serializer.serialize(editor.state.doc);
}

export const Markdown = Extension.create<MarkdownOptions, MarkdownStorage>({
  name: 'markdown',

  // Source copies must convert before block-level HTML handlers such as SmartPaste.
  priority: 110,

  addOptions() {
    return {
      paste: true,
      tightLists: true,
      specs: null,
    };
  },

  addStorage(): MarkdownStorage {
    return {
      parser: null,
      serializer: null,
    };
  },

  onCreate() {
    const schema = this.editor?.state.schema;
    if (schema !== undefined) this.storage.parser ??= createMarkdownParser(schema);
    this.storage.serializer ??= createMarkdownSerializer(this.options.specs ?? {}, {
      tightLists: this.options.tightLists,
    });
  },

  addCommands() {
    const parserFor = (schema: Schema): MarkdownParser => {
      this.storage.parser ??= createMarkdownParser(schema);
      return this.storage.parser;
    };

    return {
      insertMarkdown:
        (markdown: string) =>
        ({ state, commands }) => {
          const doc = parserFor(state.schema).parse(markdown);
          const first = doc.content.firstChild;
          // A single paragraph inserts as inline content so it merges into
          // the text at the cursor, matching the paste plugin's behavior.
          const content: unknown =
            doc.content.childCount === 1 && first !== null && first.type.name === 'paragraph'
              ? first.content.toJSON()
              : doc.content.toJSON();
          return commands.insertContent((content ?? []) as JSONContent[]);
        },

      setMarkdownContent:
        (markdown: string, options?: SetContentOptions) =>
        ({ state, commands }) => {
          const doc = parserFor(state.schema).parse(markdown);
          return commands.setContent(doc.toJSON() as JSONContent, options);
        },
    };
  },

  addProseMirrorPlugins() {
    if (!this.options.paste) return [];
    return [
      markdownPastePlugin(() => {
        const schema = this.editor?.state.schema;
        if (schema !== undefined) this.storage.parser ??= createMarkdownParser(schema);
        const parser = this.storage.parser;
        if (parser === null) throw new Error('Markdown parser is unavailable before editor create');
        return parser;
      }),
    ];
  },
});
