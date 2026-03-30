/**
 * Custom inputRules plugin with built-in Backspace undo.
 *
 * Two enhancements over ProseMirror's built-in inputRules plugin:
 *
 * 1. Preserves undo state across appendTransaction (e.g. TrailingNode).
 *    PM's plugin clears state on any docChanged transaction, so
 *    appendTransaction handlers that fire after an input rule erase the
 *    undo info before the user can press Backspace.
 *
 * 2. Handles Backspace directly via handleKeyDown (highest priority in
 *    ProseMirror's event dispatch) so no other keymap can intercept it
 *    first. If the plugin has stored undo state, Backspace inverts the
 *    input rule steps and restores the original typed text.
 */
import { Plugin } from '@domternal/pm/state';
import type { InputRule } from '@domternal/pm/inputrules';
import type { EditorView } from '@domternal/pm/view';
import type { EditorState, Transaction } from '@domternal/pm/state';

interface InternalRule {
  match: RegExp;
  handler: (state: EditorState, match: RegExpExecArray, start: number, end: number) => Transaction | null;
  undoable: boolean;
  inCode: boolean | 'only';
  inCodeMark: boolean;
}

const MAX_MATCH = 500;

function run(
  view: EditorView,
  from: number,
  to: number,
  text: string,
  rules: InputRule[],
  plugin: Plugin,
): boolean {
  if (view.composing) return false;

  const state = view.state;
  const $from = state.doc.resolve(from);
  const textBefore =
    $from.parent.textBetween(
      Math.max(0, $from.parentOffset - MAX_MATCH),
      $from.parentOffset,
      null,
      '\ufffc',
    ) + text;

  for (const rawRule of rules) {
    const rule = rawRule as InputRule & InternalRule;

    if (!rule.inCodeMark && $from.marks().some((m) => m.type.spec.code)) continue;
    if ($from.parent.type.spec.code) {
      if (!rule.inCode) continue;
    } else if (rule.inCode === 'only') {
      continue;
    }

    const match = rule.match.exec(textBefore);
    if (!match || match[0].length < text.length) continue;

    const startPos = from - (match[0].length - text.length);

    if (!rule.inCodeMark) {
      const codeMarks: boolean[] = [];
      state.doc.nodesBetween(startPos, $from.pos, (node) => {
        if (node.isInline && node.marks.some((m) => m.type.spec.code)) codeMarks.push(true);
      });
      if (codeMarks.length > 0) continue;
    }

    const tr = rule.handler(state, match, startPos, to);
    if (!tr) continue;

    if (rule.undoable) {
      tr.setMeta(plugin, { transform: tr, from, to, text });
    }
    view.dispatch(tr);
    return true;
  }
  return false;
}

interface InputRulesState {
  transform: Transaction;
  from: number;
  to: number;
  text: string;
}

/**
 * Undo the last input rule by inverting its steps and restoring
 * the original typed text.
 */
function undoInputRule(plugin: Plugin, state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const undoable = plugin.getState(state) as InputRulesState | null;
  if (!undoable) return false;

  if (dispatch) {
    const tr = state.tr;
    const toUndo = undoable.transform;
    for (let j = toUndo.steps.length - 1; j >= 0; j--) {
      const step = toUndo.steps[j];
      const doc = toUndo.docs[j];
      if (step && doc) tr.step(step.invert(doc));
    }
    if (undoable.text) {
      const marks = tr.doc.resolve(undoable.from).marks();
      tr.replaceWith(undoable.from, undoable.to, state.schema.text(undoable.text, marks));
    } else {
      tr.delete(undoable.from, undoable.to);
    }
    dispatch(tr);
  }
  return true;
}

/**
 * Creates an input rules plugin with built-in Backspace undo.
 *
 * Drop-in replacement for ProseMirror's `inputRules({ rules })`.
 */
export function inputRulesPlugin({ rules }: { rules: InputRule[] }): Plugin {
  const plugin: Plugin = new Plugin({
    state: {
      init(): InputRulesState | null {
        return null;
      },
      apply(tr: Transaction, prev: InputRulesState | null): InputRulesState | null {
        const stored = tr.getMeta(plugin) as InputRulesState | undefined;
        if (stored) return stored;

        // Preserve state across appendTransaction (e.g. TrailingNode)
        if (tr.getMeta('appendedTransaction')) return prev;

        return tr.selectionSet || tr.docChanged ? null : prev;
      },
    },
    props: {
      handleTextInput(view: EditorView, from: number, to: number, text: string) {
        return run(view, from, to, text, rules, plugin);
      },
      handleKeyDown(view: EditorView, event: KeyboardEvent) {
        // Intercept Backspace to undo the last input rule.
        // handleKeyDown fires before any keymap plugin, so this
        // cannot be blocked by extension Backspace handlers.
        if (event.key === 'Backspace' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          return undoInputRule(plugin, view.state, (tr) => { view.dispatch(tr); });
        }
        return false;
      },
      handleDOMEvents: {
        compositionend: (view: EditorView) => {
          setTimeout(() => {
            const { $cursor } = view.state.selection as { $cursor?: { pos: number } };
            if ($cursor) { run(view, $cursor.pos, $cursor.pos, '', rules, plugin); }
          });
        },
      },
    },
    // Tag so external undoInputRule can also find this plugin
    isInputRules: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as ConstructorParameters<typeof Plugin<any>>[0] & { isInputRules: boolean });

  return plugin;
}
