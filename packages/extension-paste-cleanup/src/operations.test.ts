import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bold, BulletList, Document, Editor, Extension, Heading, History, ListItem, Paragraph, Text } from '@domternal/core';
import { Fragment, Slice } from '@domternal/pm/model';
import { Table, TableCell, TableHeader, TableRow } from '../../extension-table/dist/index.js';
import type { AnyExtension, EditorOptions } from '@domternal/core';
import { Plugin, TextSelection } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import {
  coveredDepths,
  getPasteAffectedReferences,
  pasteCleanupKey,
  pasteDocumentRevision,
  readPasteReceipt,
  receiptStateField,
} from './operations.js';
import type { PasteAffectedReferences, PasteInsertion } from './operations.js';

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

function mount(options: {
  content?: string;
  plugins?: Plugin[];
  onTransaction?: EditorOptions['onTransaction'];
  withReceipts?: boolean;
} = {}): Editor {
  const Receipts = Extension.create({
    name: 'receiptTestHost',
    addProseMirrorPlugins: () => [
      ...(options.withReceipts === false ? [] : [new Plugin({ key: pasteCleanupKey, state: receiptStateField })]),
      ...(options.plugins ?? []),
    ],
  });
  const editor = new Editor({
    extensions: [Document, Paragraph, Text, Bold, History, Receipts],
    content: options.content ?? '<p>Before old after</p>',
    ...(options.onTransaction === undefined ? {} : { onTransaction: options.onTransaction }),
  });
  editors.push(editor);
  return editor;
}

function tag(transaction: Transaction, id = 'operation'): Transaction {
  return transaction.setMeta(pasteCleanupKey, Object.freeze({ operationId: id })).setMeta('paste', true);
}

function replace(instance: Editor, id = 'operation'): void {
  instance.view.dispatch(tag(instance.state.tr.insertText('New', 8, 11), id));
}

function references(instance: Editor, id = 'operation'): PasteAffectedReferences {
  const value = getPasteAffectedReferences(instance.view, id);
  expect(value).toBeDefined();
  if (value === undefined) throw new Error('The installed receipt must exist');
  return value;
}

describe('installed paste receipts', () => {
  it('records replacement geometry only after the transaction is installed', () => {
    const instance = mount();
    const before = instance.state.doc.firstChild;
    const transaction = tag(instance.state.tr.insertText('New', 8, 11));

    expect(getPasteAffectedReferences(instance.view, 'operation')).toBeUndefined();
    expect(pasteDocumentRevision(instance.view)).toBe(0);
    instance.view.dispatch(transaction);

    expect(instance.getHTML()).toBe('<p>Before New after</p>');
    expect(readPasteReceipt(instance.view, 'operation')).toEqual({
      changed: true,
      references: {
        referenceId: 'operation', precision: 'operation', documentRevision: 1,
        ranges: [{ from: 8, to: 11 }], expired: false,
      },
      // The replacement created no heading and joined the paragraph it started in.
      insertion: { createdHeadings: 0, joined: before, joinedCovered: false },
    });
  });

  it('distinguishes an accepted selection-only transaction from a changed document', () => {
    const instance = mount();

    instance.view.dispatch(tag(instance.state.tr.setSelection(TextSelection.create(instance.state.doc, 4))));

    expect(readPasteReceipt(instance.view, 'operation')).toMatchObject({
      changed: false, references: { documentRevision: 0, ranges: [], expired: false },
    });
    expect(instance.state.selection.from).toBe(4);
  });

  it('does not manufacture references when the plugin is absent or the view is destroyed', () => {
    const absent = mount({ withReceipts: false });
    replace(absent);
    expect(readPasteReceipt(absent.view, 'operation')).toBeUndefined();
    expect(pasteDocumentRevision(absent.view)).toBe(0);

    const instance = mount();
    replace(instance);
    instance.destroy();

    expect(getPasteAffectedReferences(instance.view, 'operation')).toBeUndefined();
    expect(readPasteReceipt(instance.view, 'operation')).toMatchObject({ changed: true,
      references: { expired: true, ranges: [] } });
  });

  it('keeps speculative state.apply receipts out of the installed view', () => {
    const instance = mount();
    const transaction = tag(instance.state.tr.insertText('New', 8, 11));
    const originalState = instance.state;

    const speculative = originalState.apply(transaction);

    expect(pasteCleanupKey.getState(speculative)?.receipts).toHaveLength(1);
    expect(speculative.doc.textContent).toBe('Before New after');
    expect(instance.state).toBe(originalState);
    expect(getPasteAffectedReferences(instance.view, 'operation')).toBeUndefined();
    expect(pasteDocumentRevision(instance.view)).toBe(0);

    instance.view.dispatch(transaction);
    expect(references(instance).documentRevision).toBe(1);
    expect(pasteCleanupKey.getState(instance.state)?.receipts).toHaveLength(1);
  });

  it('does not record or invalidate references for a vetoed transaction', () => {
    const instance = mount({
      plugins: [new Plugin({ filterTransaction: transaction => transaction.getMeta('veto') !== true })],
    });
    replace(instance);
    const accepted = references(instance);
    const previous = instance.state;

    instance.view.dispatch(tag(instance.state.tr.insertText('Blocked', 8, 11), 'blocked').setMeta('veto', true));

    expect(instance.state).toBe(previous);
    expect(readPasteReceipt(instance.view, 'blocked')).toBeUndefined();
    expect(references(instance)).toEqual(accepted);
  });

  it('retains an installed receipt when a post-commit observer throws', () => {
    const observer = vi.fn(() => { throw new Error('Host observer failed'); });
    const instance = mount({ onTransaction: observer });

    expect(() => { replace(instance); }).toThrow('Host observer failed');

    expect(observer).toHaveBeenCalledOnce();
    expect(instance.getHTML()).toBe('<p>Before New after</p>');
    expect(readPasteReceipt(instance.view, 'operation')).toMatchObject({
      changed: true, references: { ranges: [{ from: 8, to: 11 }], expired: false },
    });
  });

  it('returns frozen snapshots that cannot mutate installed or later references', () => {
    const instance = mount();
    replace(instance);
    const first = references(instance);

    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.ranges)).toBe(true);
    expect(Object.isFrozen(first.ranges[0])).toBe(true);
    expect(Reflect.set(first, 'expired', true)).toBe(false);
    expect(Reflect.set(first.ranges, 'length', 0)).toBe(false);
    expect(Reflect.set(first.ranges[0] as object, 'from', 0)).toBe(false);
    instance.view.dispatch(instance.state.tr.insertText('!', 1));

    expect(first).toMatchObject({ documentRevision: 1, ranges: [{ from: 8, to: 11 }], expired: false });
    expect(references(instance)).toMatchObject({ documentRevision: 2, ranges: [{ from: 9, to: 12 }], expired: false });
  });
});

describe('paste operation geometry', () => {
  it('records explicit add-mark and remove-mark ranges with empty step maps', () => {
    const instance = mount();
    const bold = instance.schema.marks['bold'];
    if (bold === undefined) throw new Error('Bold is required');

    instance.view.dispatch(tag(instance.state.tr.addMark(8, 11, bold.create()), 'add-mark'));

    expect(instance.getHTML()).toBe('<p>Before <strong>old</strong> after</p>');
    expect(references(instance, 'add-mark')).toMatchObject({ ranges: [{ from: 8, to: 11 }], expired: false });
    instance.view.dispatch(tag(instance.state.tr.removeMark(8, 11, bold), 'remove-mark'));

    expect(instance.getHTML()).toBe('<p>Before old after</p>');
    expect(readPasteReceipt(instance.view, 'remove-mark')).toMatchObject({
      changed: true, references: { ranges: [{ from: 8, to: 11 }], expired: false },
    });
    expect(references(instance, 'add-mark')).toMatchObject({ ranges: [], expired: true });
  });

  it('maps every root step into final transaction coordinates', () => {
    const instance = mount();
    const transaction = instance.state.tr.insertText('New', 8, 11).insertText('Prefix ', 1);

    instance.view.dispatch(tag(transaction));

    expect(instance.state.doc.textContent).toBe('Prefix Before New after');
    expect(references(instance)).toMatchObject({
      ranges: [{ from: 1, to: 8 }, { from: 15, to: 18 }], expired: false,
    });
  });

  it('maps mark geometry through later root insertions and compacts overlapping ranges', () => {
    const instance = mount();
    const bold = instance.schema.marks['bold'];
    if (bold === undefined) throw new Error('Bold is required');
    const transaction = instance.state.tr.addMark(8, 11, bold.create()).insertText('!', 9).insertText('Prefix ', 1);

    instance.view.dispatch(tag(transaction));

    expect(instance.state.doc.textContent).toBe('Prefix Before o!ld after');
    expect(references(instance)).toMatchObject({
      ranges: [{ from: 1, to: 8 }, { from: 15, to: 19 }], expired: false,
    });
  });

  it('extends the root receipt through accepted appended text and mark normalizers', () => {
    const instance = mount({ plugins: [new Plugin({
      appendTransaction(transactions, _oldState, state) {
        if (!transactions.some(transaction => transaction.getMeta(pasteCleanupKey) !== undefined)) return null;
        const bold = state.schema.marks['bold'];
        if (bold === undefined) throw new Error('Bold is required');
        return state.tr.insertText('!', 11).addMark(8, 12, bold.create());
      },
    })] });

    replace(instance);

    expect(instance.getHTML()).toBe('<p>Before <strong>New!</strong> after</p>');
    expect(references(instance)).toMatchObject({ documentRevision: 2, ranges: [{ from: 8, to: 12 }], expired: false });
    expect(pasteCleanupKey.getState(instance.state)?.receipts).toHaveLength(1);
  });

  it('does not include a vetoed appended normalizer in the root receipt', () => {
    const instance = mount({ plugins: [
      new Plugin({ filterTransaction: transaction => transaction.getMeta('normalizer') !== true }),
      new Plugin({ appendTransaction(transactions, _oldState, state) {
        return transactions.some(transaction => transaction.getMeta(pasteCleanupKey) !== undefined)
          ? state.tr.insertText('!', 11).setMeta('normalizer', true) : null;
      } }),
    ] });

    replace(instance);

    expect(instance.state.doc.textContent).toBe('Before New after');
    expect(references(instance)).toMatchObject({ documentRevision: 1, ranges: [{ from: 8, to: 11 }], expired: false });
  });

  it('ignores an appended descriptor whose root was never installed', () => {
    const instance = mount();
    const uninstalledRoot = tag(instance.state.tr, 'uninstalled');

    instance.view.dispatch(instance.state.tr.insertText('!', 1).setMeta('appendedTransaction', uninstalledRoot));

    expect(instance.state.doc.textContent).toBe('!Before old after');
    expect(getPasteAffectedReferences(instance.view, 'uninstalled')).toBeUndefined();
    expect(pasteDocumentRevision(instance.view)).toBe(1);
  });

  it('tracks a selection-only root that acquires document changes through multiple normalizers', () => {
    const instance = mount({ plugins: [
      new Plugin({ appendTransaction(transactions, _oldState, state) {
        return transactions.some(transaction => transaction.getMeta(pasteCleanupKey) !== undefined)
          ? state.tr.insertText('New', 8, 11).setMeta('firstNormalizer', true) : null;
      } }),
      new Plugin({ appendTransaction(transactions, _oldState, state) {
        return transactions.some(transaction => transaction.getMeta('firstNormalizer') === true)
          ? state.tr.insertText('!', 11).insertText('Prefix ', 1) : null;
      } }),
    ] });

    instance.view.dispatch(tag(instance.state.tr.setSelection(TextSelection.create(instance.state.doc, 4))));

    expect(instance.state.doc.textContent).toBe('Prefix Before New! after');
    expect(readPasteReceipt(instance.view, 'operation')).toMatchObject({
      changed: true,
      references: { documentRevision: 2, ranges: [{ from: 1, to: 8 }, { from: 15, to: 19 }], expired: false },
    });
    expect(pasteCleanupKey.getState(instance.state)?.receipts).toHaveLength(1);
  });
});

describe('short-lived paste references', () => {
  it('maps outside edits and excludes insertions exactly at either boundary', () => {
    const instance = mount();
    replace(instance);

    instance.view.dispatch(instance.state.tr.insertText('!', 8));
    expect(references(instance)).toMatchObject({ ranges: [{ from: 9, to: 12 }], expired: false });
    instance.view.dispatch(instance.state.tr.insertText('?', 12));
    expect(references(instance)).toMatchObject({ ranges: [{ from: 9, to: 12 }], expired: false });
    instance.view.dispatch(instance.state.tr.delete(1, 3));
    expect(references(instance)).toMatchObject({ ranges: [{ from: 7, to: 10 }], expired: false });
    instance.view.dispatch(instance.state.tr.insertText(' later', instance.state.doc.content.size - 1));
    expect(references(instance)).toMatchObject({ ranges: [{ from: 7, to: 10 }], expired: false });
    expect(instance.state.doc.textBetween(7, 10)).toBe('New');
  });

  it('does not invalidate or advance document revision for selection and metadata changes', () => {
    const instance = mount();
    replace(instance);
    const previous = references(instance);

    instance.view.dispatch(instance.state.tr.setSelection(TextSelection.create(instance.state.doc, 2)).setMeta('host', true));

    expect(references(instance)).toEqual(previous);
  });

  it('retains references through mark changes immediately outside their boundaries', () => {
    const instance = mount();
    replace(instance);
    const bold = instance.schema.marks['bold'];
    if (bold === undefined) throw new Error('Bold is required');

    instance.view.dispatch(instance.state.tr.addMark(1, 8, bold.create()).addMark(11, 17, bold.create()));
    expect(references(instance)).toMatchObject({ ranges: [{ from: 8, to: 11 }], expired: false });
    instance.view.dispatch(instance.state.tr.removeMark(1, 8, bold).removeMark(11, 17, bold));

    expect(instance.getHTML()).toBe('<p>Before New after</p>');
    expect(references(instance)).toMatchObject({ documentRevision: 3, ranges: [{ from: 8, to: 11 }], expired: false });
  });

  it.each(['insert', 'delete', 'replace', 'mark'] as const)('expires a reference after an interior %s', (kind) => {
    const instance = mount();
    replace(instance);
    const transaction = instance.state.tr;
    if (kind === 'insert') transaction.insertText('!', 9);
    if (kind === 'delete') transaction.delete(9, 10);
    if (kind === 'replace') transaction.insertText('Changed', 8, 11);
    if (kind === 'mark') {
      const bold = instance.schema.marks['bold'];
      if (bold === undefined) throw new Error('Bold is required');
      transaction.addMark(9, 10, bold.create());
    }

    instance.view.dispatch(transaction);

    expect(references(instance)).toMatchObject({ documentRevision: 2, ranges: [], expired: true });
    instance.view.dispatch(instance.state.tr.insertText('Outside ', 1));
    expect(references(instance)).toMatchObject({ ranges: [], expired: true });
  });

  it('expires deleted and whole-document-replaced content', () => {
    const deleted = mount();
    replace(deleted);
    deleted.view.dispatch(deleted.state.tr.delete(8, 11));
    expect(references(deleted)).toMatchObject({ ranges: [], expired: true });

    const replaced = mount();
    replace(replaced);
    const paragraph = replaced.schema.nodes['paragraph'];
    if (paragraph === undefined) throw new Error('Paragraph is required');
    replaced.view.dispatch(replaced.state.tr.replaceWith(0, replaced.state.doc.content.size, paragraph.create(null, replaced.schema.text('Replacement'))));
    expect(replaced.getHTML()).toBe('<p>Replacement</p>');
    expect(references(replaced)).toMatchObject({ ranges: [], expired: true });
  });

  it('expires undo references and does not revive them when redo restores the content', () => {
    const instance = mount();
    replace(instance);
    expect(instance.commands.undo()).toBe(true);

    expect(instance.getHTML()).toBe('<p>Before old after</p>');
    expect(references(instance)).toMatchObject({ ranges: [], expired: true });
    expect(instance.commands.redo()).toBe(true);
    expect(instance.getHTML()).toBe('<p>Before New after</p>');
    expect(references(instance)).toMatchObject({ ranges: [], expired: true });
  });

  it('keeps unaffected ranges but marks the operation expired when one range is edited', () => {
    const instance = mount();
    instance.view.dispatch(tag(instance.state.tr.insertText('New', 8, 11).insertText('Prefix ', 1)));

    instance.view.dispatch(instance.state.tr.insertText('!', 16));

    expect(references(instance)).toMatchObject({ ranges: [{ from: 1, to: 8 }], expired: true });
  });

  it('retains only the latest bounded set of operations', () => {
    const instance = mount({ content: '<p></p>' });
    for (let index = 0; index < 17; index++) {
      instance.view.dispatch(tag(instance.state.tr.insertText(String(index % 10), instance.state.doc.content.size - 1), `paste-${String(index)}`));
    }

    expect(getPasteAffectedReferences(instance.view, 'paste-0')).toBeUndefined();
    expect(pasteCleanupKey.getState(instance.state)?.receipts).toHaveLength(16);
    expect(references(instance, 'paste-1')).toMatchObject({ documentRevision: 17, ranges: [{ from: 2, to: 3 }], expired: false });
    expect(references(instance, 'paste-16')).toMatchObject({ ranges: [{ from: 17, to: 18 }], expired: false });
  });

  it('expires incomplete geometry when one operation exceeds its range budget', () => {
    const instance = mount({ content: `<p>${'x'.repeat(40)}</p>` });
    const transaction = instance.state.tr;
    for (let index = 0; index < 33; index++) transaction.insertText('!', 1 + index * 2);

    instance.view.dispatch(tag(transaction));

    expect(instance.state.doc.textContent).toBe('!x'.repeat(33) + 'x'.repeat(7));
    const value = references(instance);
    expect(value.expired).toBe(true);
    expect(value.ranges.length).toBeLessThanOrEqual(32);
    expect(value.ranges.every(range => range.from >= 0 && range.to <= instance.state.doc.content.size)).toBe(true);
  });

  it('applies the range budget across the root and its appended normalizer', () => {
    const instance = mount({
      content: `<p>${'x'.repeat(40)}</p>`,
      plugins: [new Plugin({ appendTransaction(transactions, _oldState, state) {
        return transactions.some(transaction => transaction.getMeta(pasteCleanupKey) !== undefined)
          ? state.tr.insertText('?', 66) : null;
      } })],
    });
    const transaction = instance.state.tr;
    for (let index = 0; index < 32; index++) transaction.insertText('!', 1 + index * 2);

    instance.view.dispatch(tag(transaction));

    expect(instance.state.doc.textContent).toBe('!x'.repeat(32) + 'x?xxxxxxx');
    expect(references(instance)).toMatchObject({ documentRevision: 2, ranges: [], expired: true });
  });
});

describe('what an accepted paste inserted', () => {
  function mountHeadings(content: string, plugins: Plugin[] = []): Editor {
    const Receipts = Extension.create({
      name: 'receiptInsertionHost',
      addProseMirrorPlugins: () => [new Plugin({ key: pasteCleanupKey, state: receiptStateField }), ...plugins],
    });
    const editor = new Editor({ extensions: [Document, Paragraph, Text, Heading, Receipts], content });
    editors.push(editor);
    return editor;
  }
  const insertion = (instance: Editor, id = 'operation'): PasteInsertion | undefined => readPasteReceipt(instance.view, id)?.insertion;
  const heading = (instance: Editor, text: string, level = 4): ReturnType<Editor['schema']['node']> =>
    instance.schema.node('heading', { level }, instance.schema.text(text));
  const openHeading = (instance: Editor, text: string): Slice => new Slice(Fragment.from(heading(instance, text)), 1, 1);
  function at(instance: Editor, from: number, to = from): void {
    instance.view.dispatch(instance.state.tr.setSelection(TextSelection.create(instance.state.doc, from, to)));
  }

  it('counts the headings that start inside the root change, and no heading around or after it', () => {
    const instance = mountHeadings('<h2>Kept</h2><p>Hello world</p><h3>After</h3>');
    instance.view.dispatch(tag(instance.state.tr.replaceWith(6, 19, [heading(instance, 'A'), heading(instance, 'B')])));
    expect(instance.getHTML()).toBe('<h2>Kept</h2><h4>A</h4><h4>B</h4><h3>After</h3>');
    expect(insertion(instance)).toEqual({ createdHeadings: 2, joinedCovered: false });
  });

  it('names the textblock a merge joined, even a heading, and creates no heading', () => {
    for (const content of ['<p>Hello world</p>', '<h2>Hello world</h2>']) {
      const instance = mountHeadings(content);
      const joined = instance.state.doc.firstChild;
      at(instance, 7);
      instance.view.dispatch(tag(instance.state.tr.replaceSelection(openHeading(instance, 'Five'))));
      expect(instance.state.doc.childCount).toBe(1);
      expect(instance.state.doc.firstChild?.textContent).toBe('Hello Fiveworld');
      expect(insertion(instance)).toEqual({ createdHeadings: 0, joined, joinedCovered: false });
    }
  });

  it('counts a heading that starts where the change ends as outside it', () => {
    const instance = mountHeadings('<p>ab</p><h2>X</h2>');
    instance.view.dispatch(tag(instance.state.tr.insertText('Z', 3)));
    expect(instance.getHTML()).toBe('<p>abZ</p><h2>X</h2>');
    expect(insertion(instance)?.createdHeadings).toBe(0);
  });

  it('counts a heading inserted between split halves, and a split heading tail, as created', () => {
    const paragraph = mountHeadings('<p>Hello world</p>');
    const tr = paragraph.state.tr.split(7);
    paragraph.view.dispatch(tag(tr.insert(8, heading(paragraph, 'Five'))));
    expect(paragraph.getHTML()).toBe('<p>Hello </p><h4>Five</h4><p>world</p>');
    expect(insertion(paragraph)?.createdHeadings).toBe(1);
    const split = mountHeadings('<h2>Hello world</h2>');
    split.view.dispatch(tag(split.state.tr.split(7)));
    expect(split.getHTML()).toBe('<h2>Hello </h2><h2>world</h2>');
    expect(insertion(split)?.createdHeadings).toBe(1);
  });

  it('knows a heading replaced at a block boundary joined nothing', () => {
    const instance = mountHeadings('<p>Hello world</p>');
    at(instance, 1);
    instance.view.dispatch(tag(instance.state.tr.replaceSelection(openHeading(instance, 'Five'))));
    expect(instance.getHTML()).toBe('<h4>FiveHello world</h4>');
    expect(insertion(instance)).toEqual({ createdHeadings: 1, joinedCovered: false });
  });

  it('knows when the replace covered the whole textblock it joined, as prosemirror-transform decides it', () => {
    const cases = [
      // The whole content of the heading: empty, wholly selected, or with a sibling it ends in.
      ['<h4></h4>', 1, 1, 0, true], ['<h4>Hello world</h4>', 1, 12, 0, true], ['<h4>Hello</h4><p>World</p>', 1, 13, 0, true],
      // Other text of the heading stays, or the range ends inside the next block.
      ['<h4>Hello world</h4>', 1, 4, 0, false], ['<h4>Hello world</h4>', 4, 12, 0, false], ['<h4>Hello world</h4>', 1, 1, 0, false],
      ['<h4>Hello</h4><p>World</p>', 1, 10, 0, false],
      // ProseMirror counts a sibling only for the first child of its parent.
      ['<p>Intro</p><h4>Hello</h4><p>World</p>', 8, 20, 1, false],
    ] as const;
    for (const [content, from, to, child, covered] of cases) {
      const instance = mountHeadings(content);
      const joined = instance.state.doc.child(child);
      at(instance, from, to);
      instance.view.dispatch(tag(instance.state.tr.replaceSelection(openHeading(instance, 'Five'))));
      expect({ content, from, to, insertion: insertion(instance) }).toEqual({ content, from, to, insertion: { createdHeadings: 0, joined, joinedCovered: covered } });
      expect(instance.state.doc.child(child).type.name).toBe('heading');
    }
  });

  it('counts a covered block only where its parent takes a heading', () => {
    // The paragraph and its item are covered, but neither the item nor the list takes a heading
    // there, so the pasted heading can only merge; a whole list would be replaced instead.
    const Items = Extension.create({ name: 'itemHost', addProseMirrorPlugins: () => [new Plugin({ key: pasteCleanupKey, state: receiptStateField })] });
    const editor = new Editor({ extensions: [Document, Paragraph, Text, Heading, BulletList, ListItem, Items], content: '<ul><li><p>Hello</p></li><li><p>Two</p></li></ul>' });
    editors.push(editor);
    const joined = editor.state.doc.firstChild?.firstChild?.firstChild;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3, 8)));
    editor.view.dispatch(tag(editor.state.tr.replaceSelection(new Slice(Fragment.from(editor.schema.node('heading', { level: 4 }, editor.schema.text('Five'))), 1, 1))));
    expect(editor.getHTML()).toBe('<ul><li><p>Five</p></li><li><p>Two</p></li></ul>');
    expect(readPasteReceipt(editor.view, 'operation')?.insertion).toEqual({ createdHeadings: 0, joined, joinedCovered: false });
  });

  it('measures the joined textblock in the document before the paste, where a tail it lost still counts', () => {
    // The first heading merges into the level 4 heading, and its old text moves to the pasted tail.
    const instance = mountHeadings('<h4>Hello world</h4>');
    const joined = instance.state.doc.firstChild;
    at(instance, 1);
    const slice = new Slice(Fragment.from([heading(instance, 'Five'), heading(instance, 'Six', 3)]), 1, 1);
    instance.view.dispatch(tag(instance.state.tr.replaceSelection(slice)));
    expect(instance.getHTML()).toBe('<h4>Five</h4><h3>SixHello world</h3>');
    expect(insertion(instance)).toEqual({ createdHeadings: 1, joined, joinedCovered: false });
  });

  it('keeps the root measure through an appended transaction that adds a heading', () => {
    const instance = mountHeadings('<p>Hello</p>', [new Plugin({ appendTransaction(transactions, _oldState, state) {
      if (!transactions.some(transaction => transaction.getMeta(pasteCleanupKey) !== undefined)) return null;
      const type = state.schema.nodes['heading'];
      if (type === undefined) throw new Error('Heading is required');
      return state.tr.insert(state.doc.content.size, type.create({ level: 2 }, state.schema.text('Appended')));
    } })]);
    instance.view.dispatch(tag(instance.state.tr.insertText('!', 6)));
    expect(instance.getHTML()).toBe('<p>Hello!</p><h2>Appended</h2>');
    expect(insertion(instance)?.createdHeadings).toBe(0);
    expect(readPasteReceipt(instance.view, 'operation')?.changed).toBe(true);
  });

  it('knows nothing when the root change expired, a second root reused the id, or no receipt exists', () => {
    const instance = mountHeadings(`<p>${'x'.repeat(40)}</p>`);
    const transaction = instance.state.tr;
    for (let index = 0; index < 33; index++) transaction.insertText('!', 1 + index * 2);
    instance.view.dispatch(tag(transaction));
    expect(readPasteReceipt(instance.view, 'operation')?.references.expired).toBe(true);
    expect(insertion(instance)).toBeUndefined();
    const repeated = mountHeadings('<p>Hello</p>');
    repeated.view.dispatch(tag(repeated.state.tr.insertText('A', 1)));
    expect(insertion(repeated)?.createdHeadings).toBe(0);
    repeated.view.dispatch(tag(repeated.state.tr.insert(0, heading(repeated, 'Again'))));
    expect(readPasteReceipt(repeated.view, 'operation')?.changed).toBe(true);
    expect(insertion(repeated)).toBeUndefined();
    instance.view.dispatch(instance.state.tr.insert(0, heading(instance, 'Untagged')));
    expect(readPasteReceipt(instance.view, 'untagged')).toBeUndefined();
  });

  it('knows no joined textblock for a change that starts between blocks', () => {
    const instance = mountHeadings('<p>A</p><p>B</p>');
    instance.view.dispatch(tag(instance.state.tr.insert(3, heading(instance, 'Between'))));
    expect(instance.getHTML()).toBe('<p>A</p><h4>Between</h4><p>B</p>');
    expect(insertion(instance)).toEqual({ createdHeadings: 1, joinedCovered: false });
  });
});

describe('the depths a replacement covers whole', () => {
  function depths(content: string, from: number, to: number, extensions: AnyExtension[] = []): number[] {
    const editor = new Editor({ extensions: [Document, Paragraph, Text, Heading, BulletList, ListItem, ...extensions], content });
    editors.push(editor);
    return coveredDepths(editor.state.doc.resolve(from), editor.state.doc.resolve(to));
  }

  it('covers a textblock whose whole content is replaced, and each ancestor it fills', () => {
    expect(depths('<p></p>', 1, 1)).toEqual([1, 0]);
    expect(depths('<p>Hello</p>', 1, 6)).toEqual([1, 0]);
    expect(depths('<p>Hello</p><p>Two</p>', 1, 6)).toEqual([1]);
    expect(depths('<ul><li><p>Hello</p></li><li><p>Two</p></li></ul>', 3, 8)).toEqual([3, 2]);
    expect(depths('<ul><li><p>Hello</p></li></ul>', 3, 8)).toEqual([3, 2, 1, 0]);
  });

  it('covers nothing when text of the block stays on either side', () => {
    expect(depths('<p>Hello</p>', 2, 6)).toEqual([]);
    expect(depths('<p>Hello</p>', 1, 5)).toEqual([]);
    expect(depths('<p>Hello</p>', 3, 3)).toEqual([]);
  });

  it('covers a first textblock through a whole sibling at the same depth, as ProseMirror does', () => {
    expect(depths('<h4>Hello</h4><p>World</p>', 1, 13)).toEqual([1, 0]);
    expect(depths('<h4>Hello</h4><p>World</p>', 1, 10)).toEqual([]);
    expect(depths('<p>Intro</p><h4>Hello</h4><p>World</p>', 8, 20)).toEqual([]);
  });

  it('stops at an isolating node', () => {
    // The cell is isolating: a replacement of its whole text never covers the cell or the table.
    expect(depths('<table><tr><td><p>Hello</p></td></tr></table>', 4, 9, [Table, TableRow, TableCell, TableHeader])).toEqual([4]);
  });
});
