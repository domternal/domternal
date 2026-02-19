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
import type { CommandSpec } from '../types/Commands.js';
import type { ToolbarItem } from '../types/Toolbar.js';

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

          // Use tr.selection for chain compatibility - prior commands may have changed selection
          const { $from } = tr.selection;
          const parent = $from.parent;

          if (dispatch) {
            // If cursor is in an empty block, replace it with HR + new paragraph
            if (parent.content.size === 0 && parent.type.name === 'paragraph') {
              const from = $from.before();
              const to = $from.after();
              const paragraph = state.schema.nodes['paragraph']?.create();
              const nodes = paragraph
                ? [this.nodeType.create(), paragraph]
                : [this.nodeType.create()];
              tr.replaceWith(from, to, nodes);

              // Move cursor into the new paragraph
              const sel = TextSelection.findFrom(tr.doc.resolve(from + 1), 1);
              if (sel) tr.setSelection(sel);
            } else {
              // Insert HR after current position
              const end = $from.after();
              const paragraph = state.schema.nodes['paragraph']?.create();
              const nodes = paragraph
                ? [this.nodeType.create(), paragraph]
                : [this.nodeType.create()];
              tr.insert(end, nodes);

              // Move cursor into the new paragraph
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

  addInputRules() {
    const { nodeType } = this;

    if (!nodeType) {
      return [];
    }

    return [
      new InputRule(
        /^(?:---|—-|___|\*\*\*)\s$/,
        (state: EditorState, match: RegExpMatchArray, start: number) => {
          const { tr } = state;

          if (match[0]) {
            const $start = state.doc.resolve(start);
            // Replace the entire parent block (paragraph) with HR
            const from = $start.before();
            const to = $start.after();
            tr.replaceWith(from, to, nodeType.create());

            // Move selection after the HR if possible
            if (from + 1 < tr.doc.content.size) {
              const $after = tr.doc.resolve(from + 1);
              const sel = TextSelection.findFrom($after, 1);
              if (sel) {
                tr.setSelection(sel);
              }
            }
          }

          return tr;
        }
      ),
    ];
  },
});
