/**
 * HorizontalRule Node
 *
 * Block-level thematic break element (hr).
 * Supports markdown-style input rules: ---, ***, ___
 */

import { Node } from '../Node.js';
import { InputRule } from 'prosemirror-inputrules';
import type { EditorState } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';

export interface HorizontalRuleOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const HorizontalRule = Node.create<HorizontalRuleOptions>({
  name: 'horizontalRule',
  group: 'block',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'hr' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['hr', { ...this.options.HTMLAttributes, ...HTMLAttributes }];
  },

  addCommands() {
    const { name } = this;
    return {
      setHorizontalRule:
        () =>
        ({ commands, tr }) => {
          const cmds = commands as Record<
            string,
            (content: { type: string }) => boolean
          >;

          // Insert horizontal rule
          const result = cmds['insertContent']?.({ type: name });
          if (!result) return false;

          // Try to move selection after the HR
          const { $to } = tr.selection;
          const posAfter = $to.end();

          if (posAfter < tr.doc.content.size) {
            const newSelection = TextSelection.create(tr.doc, posAfter + 1);
            tr.setSelection(newSelection);
          }

          return true;
        },
    };
  },

  addInputRules() {
    const { nodeType } = this;

    if (!nodeType) {
      return [];
    }

    return [
      new InputRule(
        /^(?:---|—-|___|\*\*\*)\s$/,
        (state: EditorState, match: RegExpMatchArray, start: number, end: number) => {
          const { tr } = state;

          if (match[0]) {
            tr.replaceWith(start - 1, end, nodeType.create());

            // Move selection after the HR if possible
            const resolvedPos = tr.doc.resolve(start);
            const posAfter = resolvedPos.after();

            if (posAfter < tr.doc.content.size) {
              tr.setSelection(TextSelection.create(tr.doc, posAfter));
            }
          }

          return tr;
        }
      ),
    ];
  },
});
