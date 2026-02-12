import { CodeBlock } from '@domternal/core';
import type { CodeBlockOptions } from '@domternal/core';
import { lowlightPlugin } from './lowlightPlugin.js';
import type { Lowlight } from './lowlightPlugin.js';

export interface CodeBlockLowlightOptions extends CodeBlockOptions {
  /** The lowlight instance (required). Create with createLowlight(). */
  lowlight: Lowlight;
  /** Default language when none is specified. @default null */
  defaultLanguage: string | null;
  /** Auto-detect language when none specified. @default false */
  autoDetect: boolean;
  /** Tab key inserts spaces in code blocks. @default true */
  tabIndentation: boolean;
  /** Number of spaces per tab. @default 2 */
  tabSize: number;
}

export interface CodeBlockLowlightStorage {
  /** Returns list of registered language names */
  listLanguages: () => string[];
}

export const CodeBlockLowlight = CodeBlock.extend<CodeBlockLowlightOptions, CodeBlockLowlightStorage>({
  addOptions() {
    return {
      ...CodeBlock.options,
      lowlight: null as unknown as Lowlight,
      defaultLanguage: null,
      autoDetect: false,
      tabIndentation: true,
      tabSize: 2,
    };
  },

  addStorage() {
    return {
      listLanguages: (): string[] => {
        return this.options.lowlight?.listLanguages?.() ?? [];
      },
    };
  },

  addKeyboardShortcuts() {
    const parentShortcuts = CodeBlock.config.addKeyboardShortcuts?.call(this) ?? {};

    if (!this.options.tabIndentation) return parentShortcuts;

    const spaces = ' '.repeat(this.options.tabSize);

    return {
      ...parentShortcuts,
      Tab: () => {
        if (!this.editor) return false;
        const { state } = this.editor;
        if (state.selection.$head.parent.type.name !== this.name) return false;
        return this.editor.commands['insertText']?.(spaces) ?? false;
      },
      'Shift-Tab': () => {
        if (!this.editor) return false;
        const { state } = this.editor;
        const { $head } = state.selection;
        if ($head.parent.type.name !== this.name) return false;

        const textBefore = $head.parent.textBetween(0, $head.parentOffset);
        const lastNewline = textBefore.lastIndexOf('\n');
        const lineStart = lastNewline + 1;
        const lineText = textBefore.slice(lineStart);
        const leadingSpaces = lineText.match(/^ */)?.[0]?.length ?? 0;
        const spacesToRemove = Math.min(leadingSpaces, this.options.tabSize);

        if (spacesToRemove === 0) return false;

        const deleteFrom = $head.start() + lineStart;
        const { tr } = state;
        tr.delete(deleteFrom, deleteFrom + spacesToRemove);
        this.editor.view.dispatch(tr);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      ...(CodeBlock.config.addProseMirrorPlugins?.call(this) ?? []),
      lowlightPlugin({
        name: this.name,
        lowlight: this.options.lowlight,
        defaultLanguage: this.options.defaultLanguage,
        autoDetect: this.options.autoDetect,
      }),
    ];
  },
});
