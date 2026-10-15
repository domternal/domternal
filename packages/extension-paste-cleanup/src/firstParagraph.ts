import type { Node as PMNode, Slice } from '@domternal/pm/model';
import type { EditorState, Transaction } from '@domternal/pm/state';
import { pasteCleanupKey } from './operations.js';
import { paragraphTextIdentity } from './html/firstParagraph.js';
import type { FirstParagraphFormat } from './html/firstParagraph.js';

interface ParagraphIntent {
  readonly doc: PMNode;
  readonly position: number;
  readonly caret: number;
  readonly target: PMNode;
  readonly source: PMNode;
  readonly attrs: Readonly<Partial<Record<'textAlign' | 'lineHeight', string>>>;
}

function comparable(value: string): string {
  return value.replace(/^([0-9]+(?:\.[0-9]+)?)(.*)$/u, (_match, number: string, unit: string) => `${String(Number(number))}${unit}`);
}

/** Preserve only explicit source properties when an accepted paste fills its original empty paragraph. */
export function createFirstParagraphPreserver(): {
  remember: (id: string, slice: Slice, state: EditorState, format: Readonly<FirstParagraphFormat> | undefined) => void;
  append: (transactions: readonly Transaction[], state: EditorState) => Transaction | null;
} {
  const intents = new Map<string, ParagraphIntent>();
  return {
    remember(id, slice, state, format) {
      const { selection } = state;
      const target = selection.$from.parent;
      const source = slice.content.firstChild;
      if (format === undefined || !selection.empty || target.type.name !== 'paragraph' || target.content.size !== 0
        || slice.openStart !== 1 || source?.type !== target.type || !source.isTextblock
        || paragraphTextIdentity(source.textBetween(0, source.content.size, '', node => node.type.name === 'hardBreak' ? ' ' : '')) !== format.text) return;
      const attrs: Partial<Record<'textAlign' | 'lineHeight', string>> = {};
      for (const name of ['textAlign', 'lineHeight'] as const) {
        const value: unknown = source.attrs[name];
        const expected = format[name];
        // Later host transforms can replace the first paragraph or remove a declaration. They retain precedence.
        if (expected === undefined || typeof value !== 'string' || comparable(value) !== comparable(expected) || value === target.attrs[name]) continue;
        attrs[name] = value;
      }
      if (Object.keys(attrs).length === 0) return;
      const intent = { doc: state.doc, position: selection.$from.before(), caret: selection.from, target, source, attrs };
      intents.set(id, intent);
      queueMicrotask(() => { if (intents.get(id) === intent) intents.delete(id); });
    },
    append(transactions, state) {
      for (let index = 0; index < transactions.length; index++) {
        const root = transactions[index];
        if (root === undefined) continue;
        const metadata: unknown = root.getMeta(pasteCleanupKey);
        if (metadata === null || typeof metadata !== 'object' || !('operationId' in metadata) || typeof metadata.operationId !== 'string') continue;
        const intent = intents.get(metadata.operationId);
        intents.delete(metadata.operationId);
        if (root.before !== intent?.doc || !root.docChanged) continue;
        const edits: { from: number; to: number; inserted: boolean }[] = [];
        root.mapping.maps[0]?.forEach((from, to, newFrom, newTo) => {
          edits.push({ from, to, inserted: newTo > newFrom });
        });
        if (!edits.some(edit => edit.from <= intent.caret && edit.to >= intent.caret && edit.inserted)) continue;
        let position = intent.position;
        for (const transaction of transactions.slice(index)) position = transaction.mapping.map(position, -1);
        const paragraph = state.doc.nodeAt(position);
        // A custom handler or an earlier normalizer can replace, move or edit the inserted content.
        if (paragraph?.type !== intent.target.type || !paragraph.content.eq(intent.source.content)) continue;
        const attrs = { ...paragraph.attrs };
        let changed = false;
        for (const name of ['textAlign', 'lineHeight'] as const) {
          const value = intent.attrs[name];
          if (value === undefined || attrs[name] !== intent.target.attrs[name]) continue;
          attrs[name] = value;
          changed = true;
        }
        // Use the installed paragraph's other attributes, including its existing UniqueID.
        if (changed) return state.tr.setNodeMarkup(position, undefined, attrs);
      }
      return null;
    },
  };
}
