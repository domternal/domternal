/**
 * HorizontalRule Node
 *
 * Block-level thematic break element (hr).
 * Supports markdown-style input rules: ---, ***, ___
 */

import { Node } from '../Node.js';
import { InputRule } from '@domternal/pm/inputrules';
import type { EditorState } from '@domternal/pm/state';
import { TextSelection } from '@domternal/pm/state';
import type { CommandSpec } from '../types/Commands.js';
import type { ToolbarItem } from '../types/Toolbar.js';
import type { FloatingMenuItem } from '../types/FloatingMenu.js';
import { splitListForInsert } from '../utils/splitListForInsert.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    setHorizontalRule: CommandSpec;
  }
}

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
    return {
      setHorizontalRule:
        () =>
        ({ state, tr, dispatch }) => {
          if (!this.nodeType) return false;

          const { $from } = tr.selection;
          const parent = $from.parent;

          // Block insertion when selection is not in a textblock (e.g. CellSelection
          // resolves $from at the tableRow level - inserting HR there splits the table)
          if (!parent.isTextblock) return false;

          const paragraphType = state.schema.nodes['paragraph'];
          const hrNode = this.nodeType.create();
          const trailingParagraph = paragraphType?.create();
          const nodes = trailingParagraph ? [hrNode, trailingParagraph] : [hrNode];

          // List-item-aware path: cursor in the LABEL paragraph of a
          // list/task item. The divider belongs at TOP LEVEL, not nested
          // inside the list item. The util splits the parent list around
          // the current item (empty label is consumed) so the existing
          // bullet/number/check stays intact above the divider.
          const listRange = splitListForInsert(state, tr);
          if (listRange) {
            if (!dispatch) return true;
            tr.replaceWith(listRange.from, listRange.to, nodes);
            const sel = TextSelection.findFrom(
              tr.doc.resolve(listRange.from + 1),
              1,
            );
            if (sel) tr.setSelection(sel);
            dispatch(tr.scrollIntoView());
            return true;
          }

          if (dispatch) {
            // If cursor is in an empty block, replace it with HR + new paragraph
            if (parent.content.size === 0 && parent.type.name === 'paragraph') {
              const from = $from.before();
              const to = $from.after();
              tr.replaceWith(from, to, nodes);
              const sel = TextSelection.findFrom(tr.doc.resolve(from + 1), 1);
              if (sel) tr.setSelection(sel);
            } else {
              // Insert HR after current position
              const end = $from.after();
              tr.insert(end, nodes);
              const sel = TextSelection.findFrom(tr.doc.resolve(end + 1), 1);
              if (sel) tr.setSelection(sel);
            }

            dispatch(tr);
          }

          return true;
        },
    };
  },

  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'horizontalRule',
        command: 'setHorizontalRule',
        icon: 'minus',
        label: 'Horizontal Rule',
        group: 'blocks',
        priority: 130,
      },
    ];
  },

  addFloatingMenuItems(): FloatingMenuItem[] {
    return [
      {
        name: 'horizontal-rule',
        label: 'Divider',
        description: 'Insert a horizontal rule',
        icon: 'minus',
        group: 'Basic',
        priority: 150,
        keywords: ['divider', 'hr', 'line', 'separator', 'horizontal rule'],
        shortcut: '--- ',
        command: 'setHorizontalRule',
      },
    ];
  },

  addInputRules() {
    const { nodeType } = this;

    if (!nodeType) {
      return [];
    }

    return [
      new InputRule(
        /^(?:---|--|___|\*\*\*)\s$/,
        (state: EditorState, match: RegExpMatchArray, start: number) => {
          const { tr } = state;

          if (match[0]) {
            const $start = state.doc.resolve(start);
            // Replace the entire parent block (paragraph) with HR + new paragraph
            const from = $start.before();
            const to = $start.after();
            const paragraph = state.schema.nodes['paragraph']?.create();
            const nodes = paragraph
              ? [nodeType.create(), paragraph]
              : [nodeType.create()];
            tr.replaceWith(from, to, nodes);

            // Move selection into the new paragraph after the HR
            const sel = TextSelection.findFrom(tr.doc.resolve(from + 1), 1);
            if (sel) {
              tr.setSelection(sel);
            }
          }

          return tr;
        }
      ),
    ];
  },
});
