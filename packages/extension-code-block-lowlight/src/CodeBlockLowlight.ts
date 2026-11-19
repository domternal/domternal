import { CodeBlock } from '@domternal/core';
import type { CodeBlockOptions } from '@domternal/core';
import type { EditorState } from '@domternal/pm/state';
import { lowlightPlugin } from './lowlightPlugin.js';
import type { Lowlight } from './lowlightPlugin.js';

export interface CodeBlockLowlightOptions extends CodeBlockOptions {
  /** The lowlight instance (required). Create with createLowlight(). Null before configure(). */
  lowlight: Lowlight | null;
  /** Default language when none is specified. @default null */
  defaultLanguage: string | null;
  /** Auto-detect language when none specified. @default true */
  autoDetect: boolean;
  /**
   * In code blocks, Tab inserts spaces at the caret or indents every selected
   * line, and Shift-Tab removes leading spaces from those lines. @default true
   */
  tabIndentation: boolean;
  /** Number of spaces per tab. A value below 1 turns tab indentation off. @default 2 */
  tabSize: number;
}

export interface CodeBlockLowlightStorage {
  /** Returns list of registered language names */
  listLanguages: () => string[];
}

interface TouchedLines {
  /** Position where the code block's text starts. */
  start: number;
  /** The code block's text, one character per position. */
  text: string;
  /** Offsets into `text` where the touched lines start, top to bottom. */
  lineStarts: number[];
}

/**
 * The lines of a code block that the selection touches. A non-empty range
 * that ends at the first column of a line does not touch that line. Returns
 * null unless both ends of the selection lie in one block named `typeName`.
 */
function touchedLines(state: EditorState, typeName: string): TouchedLines | null {
  const { $from, $to, empty } = state.selection;
  if (!$from.sameParent($to) || $from.parent.type.name !== typeName) return null;
  const block = $from.parent;
  // One placeholder per inline leaf keeps offsets equal to positions, should
  // an extended schema allow more than text in the block.
  const text = block.textBetween(0, block.content.size, undefined, '\ufffc');
  let end = $to.parentOffset;
  if (!empty && text[end - 1] === '\n') end -= 1;
  // Searching a slice keeps an empty first line right: lastIndexOf('\n', -1)
  // would match the line break at offset 0.
  const lineStarts = [text.slice(0, $from.parentOffset).lastIndexOf('\n') + 1];
  for (let i = text.indexOf('\n', $from.parentOffset); i !== -1 && i < end; i = text.indexOf('\n', i + 1)) {
    lineStarts.push(i + 1);
  }
  return { start: $from.start(), text, lineStarts };
}

export const CodeBlockLowlight = CodeBlock.extend<CodeBlockLowlightOptions, CodeBlockLowlightStorage>({
  addOptions() {
    return {
      ...CodeBlock.options,
      lowlight: null,
      defaultLanguage: null,
      autoDetect: true,
      tabIndentation: true,
      tabSize: 2,
    };
  },

  addStorage() {
    return {
      listLanguages: (): string[] => {
        return this.options.lowlight ? this.options.lowlight.listLanguages() : [];
      },
    };
  },

  addKeyboardShortcuts() {
    const parentShortcuts = CodeBlock.config.addKeyboardShortcuts?.call(this) ?? {};

    if (!this.options.tabIndentation) return parentShortcuts;

    // A tabSize without a whole space cannot indent. Keep the inherited
    // shortcuts instead of failing to build any of them.
    const size = Math.floor(this.options.tabSize);
    if (!Number.isFinite(size) || size < 1) return parentShortcuts;
    const spaces = ' '.repeat(size);

    return {
      ...parentShortcuts,
      Tab: () => {
        if (!this.editor) return false;
        const { state, view } = this.editor;
        if (state.selection.$head.parent.type.name !== this.name) return false;
        if (state.selection.empty) return this.editor.commands['insertText']?.(spaces) ?? false;

        // Indent the selected lines instead of replacing the selection. A
        // selection that leaves the block is left to other handlers.
        const lines = touchedLines(state, this.name);
        if (!lines) return false;
        const { tr } = state;
        const indent = state.schema.text(spaces);
        // Bottom up keeps the earlier positions valid, and tr.insert keeps the
        // same text selected where tr.insertText could collapse the selection.
        for (const offset of lines.lineStarts.reverse()) {
          tr.insert(lines.start + offset, indent);
        }
        view.dispatch(tr.scrollIntoView());
        return true;
      },
      'Shift-Tab': () => {
        if (!this.editor) return false;
        const { state, view } = this.editor;
        const lines = touchedLines(state, this.name);
        if (!lines) return false;
        const { start, text, lineStarts } = lines;
        const { tr } = state;
        for (const offset of lineStarts.reverse()) {
          let count = 0;
          while (count < spaces.length && text[offset + count] === ' ') count++;
          if (count > 0) tr.delete(start + offset, start + offset + count);
        }
        // Nothing to remove: leave the key to other handlers and the browser.
        if (!tr.docChanged) return false;
        view.dispatch(tr.scrollIntoView());
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
