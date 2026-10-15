// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Fragment, Schema, Slice } from '@domternal/pm/model';
import type { Mark, Node as PMNode } from '@domternal/pm/model';
import { AllSelection, EditorState, TextSelection } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import { RemoveMarkStep, ReplaceAroundStep } from '@domternal/pm/transform';
import { advancePasteContentLedger, bindPasteContentWitness, createPasteContentWitness } from './contentWitness.js';
import type { PasteContentLedger, PasteContentWitness } from './contentWitness.js';

const schema = new Schema({
  nodes: {
    doc: { content: '(paragraph | blockquote)+' },
    blockquote: { content: 'paragraph+' },
    paragraph: { content: 'text*', attrs: { textAlign: { default: null }, lineHeight: { default: null }, id: { default: null } } },
    text: {},
  },
  marks: { bold: {}, italic: {}, textStyle: { attrs: { fontFamily: { default: null }, color: { default: null }, colorToken: { default: null } } } },
});
const bold = schema.mark('bold');
const italic = schema.mark('italic');
const paragraph = (text = '', marks: readonly Mark[] = [], attrs: Record<string, unknown> = {}): PMNode =>
  schema.node('paragraph', attrs, text ? schema.text(text, marks) : []);
function setup(slice = new Slice(Fragment.from(paragraph('Source', [bold])), 1, 1)): {
  state: EditorState; slice: Slice; witness: PasteContentWitness | undefined; root: Transaction; ledger: PasteContentLedger; installed: EditorState;
} {
  const state = EditorState.create({ schema, doc: schema.node('doc', null, [paragraph()]) });
  const witness = createPasteContentWitness(slice, state);
  const root = state.tr.replaceSelection(slice);
  const ledger = bindPasteContentWitness(witness, root);
  if (ledger === undefined) throw new Error('The source text must have an exact insertion witness');
  return { state, slice, witness, root, ledger, installed: state.apply(root) };
}
function appended(root: Transaction, transaction: Transaction): Transaction {
  return transaction.setMeta('appendedTransaction', root);
}

describe('bounded identity evidence for pasted formatting', () => {
  it('binds the actual inserted source node without changing the transaction or document', () => {
    const { root, ledger } = setup();
    expect(root.doc.textContent).toBe('Source');
    expect(root.steps).toHaveLength(1);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({ from: 1, to: 7 });
    expect(ledger.formattingRemoved).toBe(false);
    expect(Object.isFrozen(ledger)).toBe(true);
    expect(Object.isFrozen(ledger.entries)).toBe(true);
    expect(Object.isFrozen(ledger.entries[0])).toBe(true);
  });

  it('does not infer ownership from the same text and attributes on newly created nodes', () => {
    const { state, witness } = setup();
    const equal = state.tr.insertText('Source').addMark(1, 7, bold);
    expect(bindPasteContentWitness(witness, equal)).toBeUndefined();
    const equalSlice = new Slice(Fragment.from(paragraph('Source', [bold])), 1, 1);
    expect(bindPasteContentWitness(witness, state.tr.replaceSelection(equalSlice))).toBeUndefined();
  });

  it('rejects repeated source identities and repeated insertion identities', () => {
    const text = schema.text('Repeated', [bold]);
    const repeated = schema.node('paragraph', null, text);
    const state = EditorState.create({ schema, doc: schema.node('doc', null, [paragraph()]) });
    const source = new Slice(Fragment.from([repeated, repeated]), 0, 0);
    expect(createPasteContentWitness(source, state)).toBeUndefined();
    const witness = createPasteContentWitness(new Slice(Fragment.from(repeated), 0, 0), state);
    expect(bindPasteContentWitness(witness, state.tr.replaceSelection(source))).toBeUndefined();
  });

  it('does not bind another document, an insertion outside the target, or an empty transaction', () => {
    const { witness, slice, state } = setup();
    const other = EditorState.create({ schema, doc: schema.node('doc', null, [paragraph('Other')]) });
    expect(bindPasteContentWitness(witness, other.tr.replaceSelection(slice))).toBeUndefined();
    expect(bindPasteContentWitness(witness, state.tr)).toBeUndefined();
    const two = EditorState.create({ schema, doc: schema.node('doc', null, [paragraph(), paragraph()]) });
    const seed = createPasteContentWitness(slice, two);
    expect(bindPasteContentWitness(seed, two.tr.setSelection(TextSelection.create(two.doc, 3)).replaceSelection(slice))).toBeUndefined();
  });

  it('expires unused sources and closes installed evidence before another task', async () => {
    const { witness, root, ledger, installed } = setup();
    await Promise.resolve();
    expect(bindPasteContentWitness(witness, root)).toBeUndefined();
    const late = appended(root, installed.tr.removeMark(1, 7, bold));
    expect(advancePasteContentLedger(ledger, late)).toBe(ledger);
  });

  it('detects partial mark removal and does not report an unrelated added mark', () => {
    const { root, ledger, installed } = setup();
    const additional = appended(root, installed.tr.addMark(2, 4, italic));
    expect(advancePasteContentLedger(ledger, additional).formattingRemoved).toBe(false);
    const removed = appended(root, installed.tr.removeMark(2, 4, bold));
    expect(advancePasteContentLedger(ledger, removed).formattingRemoved).toBe(true);
  });

  it('judges the final accepted append state after formatting is restored', () => {
    const { root, ledger, installed } = setup();
    const remove = appended(root, installed.tr.removeMark(1, 7, bold));
    const missing = advancePasteContentLedger(ledger, remove);
    const after = installed.apply(remove);
    expect(missing.formattingRemoved).toBe(true);
    const restore = appended(root, after.tr.addMark(1, 7, bold));
    expect(advancePasteContentLedger(missing, restore).formattingRemoved).toBe(false);
  });

  it('keeps independent edits and an unrelated root out of the paste evidence', () => {
    const { root, ledger, installed } = setup();
    expect(advancePasteContentLedger(ledger, installed.tr.removeMark(1, 7, bold))).toBe(ledger);
    const other = installed.tr;
    expect(advancePasteContentLedger(ledger, appended(other, installed.tr.removeMark(1, 7, bold)))).toBe(ledger);
    expect(root.doc.textContent).toBe('Source');
  });

  it('maps a disjoint inserted prefix and then checks the original text range', () => {
    const { root, ledger, installed } = setup();
    const prefix = appended(root, installed.tr.insertText('Prefix ', 1));
    const shifted = advancePasteContentLedger(ledger, prefix);
    expect(shifted.entries[0]).toMatchObject({ from: 8, to: 14 });
    const next = installed.apply(prefix);
    expect(advancePasteContentLedger(shifted, appended(root, next.tr.removeMark(8, 14, bold))).formattingRemoved).toBe(true);
  });

  it('treats overlapping replacements as uncertain even if their text is identical', () => {
    const { root, ledger, installed } = setup();
    const replace = appended(root, installed.tr.replaceWith(1, 7, schema.text('Source')));
    const result = advancePasteContentLedger(ledger, replace);
    expect(result.entries).toEqual([]);
    expect(result.formattingRemoved).toBe(false);
  });

  it('does not retain a loss claim after a replacement invalidates the witness', () => {
    const { root, ledger, installed } = setup();
    const remove = appended(root, installed.tr.removeMark(1, 7, bold));
    const missing = advancePasteContentLedger(ledger, remove);
    const state = installed.apply(remove);
    const replace = appended(root, state.tr.replaceWith(1, 7, schema.text('Source', [bold])));
    expect(advancePasteContentLedger(missing, replace).formattingRemoved).toBe(false);
  });

  it('does not trust a custom step merely because it subclasses a known mark step', () => {
    class CustomStep extends RemoveMarkStep {}
    const { root, ledger, installed } = setup();
    const custom = appended(root, installed.tr.step(new CustomStep(1, 7, bold)));
    const result = advancePasteContentLedger(ledger, custom);
    expect(result.entries).toEqual([]);
    expect(result.formattingRemoved).toBe(false);
  });

  it('follows the exact built-in markup-only wrapper replacement used by UniqueID', () => {
    const { root, ledger, installed } = setup();
    const identify = appended(root, installed.tr.setNodeMarkup(0, undefined, { id: 'generated' }));
    expect(identify.steps[0]).toBeInstanceOf(ReplaceAroundStep);
    const identified = advancePasteContentLedger(ledger, identify);
    expect(identified.entries).toHaveLength(1);
    expect(identified.formattingRemoved).toBe(false);
    const state = installed.apply(identify);
    expect(advancePasteContentLedger(identified, appended(root, state.tr.removeMark(1, 7, bold))).formattingRemoved).toBe(true);
    const range = installed.doc.resolve(0).blockRange(installed.doc.resolve(installed.doc.content.size));
    const blockquote = schema.nodes.blockquote;
    if (range === null) throw new Error('The fixture must support a blockquote wrapper');
    const wrap = installed.tr.wrap(range, [{ type: blockquote }]);
    expect(wrap.steps[0]).toBeInstanceOf(ReplaceAroundStep);
    expect(advancePasteContentLedger(ledger, appended(root, wrap)).entries).toEqual([]);
  });

  it('tracks retained explicit block attributes without treating a generated ID as formatting', () => {
    const source = paragraph('Source', [], { textAlign: 'center', lineHeight: '1.5' });
    const state = EditorState.create({ schema, doc: schema.node('doc', null, [paragraph()]) });
    const selection = state.apply(state.tr.setSelection(new AllSelection(state.doc)));
    const slice = new Slice(Fragment.from(source), 0, 0);
    const witness = createPasteContentWitness(slice, selection);
    const root = selection.tr.replaceSelection(slice);
    const ledger = bindPasteContentWitness(witness, root);
    expect(ledger).toBeDefined();
    if (ledger === undefined) throw new Error('The inserted paragraph must be witnessed');
    const installed = selection.apply(root);
    expect(advancePasteContentLedger(ledger, appended(root, installed.tr.setNodeAttribute(0, 'id', 'generated'))).formattingRemoved).toBe(false);
    expect(advancePasteContentLedger(ledger, appended(root, installed.tr.setNodeAttribute(0, 'textAlign', null))).formattingRemoved).toBe(true);
  });

  it('does not demand a schema default, but detects removal of an explicit nondefault attribute', () => {
    const configured = new Schema({ nodes: {
      doc: { content: 'paragraph+' }, paragraph: { content: 'text*', attrs: { textAlign: { default: 'left' } } }, text: {},
    } });
    const state = EditorState.create({ schema: configured, doc: configured.node('doc', null, configured.node('paragraph')) });
    const defaults = new Slice(Fragment.from(configured.node('paragraph', null, configured.text('Default'))), 0, 0);
    expect(createPasteContentWitness(defaults, state)).toBeUndefined();
    const selected = state.apply(state.tr.setSelection(new AllSelection(state.doc)));
    const source = new Slice(Fragment.from(configured.node('paragraph', { textAlign: 'center' }, configured.text('Source'))), 0, 0);
    const root = selected.tr.replaceSelection(source);
    const ledger = bindPasteContentWitness(createPasteContentWitness(source, selected), root);
    if (ledger === undefined) throw new Error('The explicit block format must have an insertion witness');
    const installed = selected.apply(root);
    const reset = appended(root, installed.tr.setNodeAttribute(0, 'textAlign', 'left'));
    expect(advancePasteContentLedger(ledger, reset).formattingRemoved).toBe(true);
  });

  it('checks removal of an explicit text-style property without exposing it in public diagnostic data', () => {
    const style = schema.mark('textStyle', { fontFamily: 'Private Font', color: '#123456' });
    const { root, ledger, installed } = setup(new Slice(Fragment.from(paragraph('Private text', [style])), 1, 1));
    const change = appended(root, installed.tr.addMark(1, 13, schema.mark('textStyle', { color: '#654321' })));
    expect(advancePasteContentLedger(ledger, change).formattingRemoved).toBe(true);
  });

  it.each([
    { color: 'rgb(18, 52, 86)' }, { color: '#654321' }, { colorToken: 'accent' },
  ])('does not label a changed spelling, value or token as removed formatting: %j', replacement => {
    const style = schema.mark('textStyle', { color: '#123456' });
    const { root, ledger, installed } = setup(new Slice(Fragment.from(paragraph('Source', [style])), 1, 1));
    const change = appended(root, installed.tr.addMark(1, 7, schema.mark('textStyle', replacement)));
    expect(advancePasteContentLedger(ledger, change).formattingRemoved).toBe(false);
    const clear = appended(root, installed.tr.addMark(1, 7, schema.mark('textStyle')));
    expect(advancePasteContentLedger(ledger, clear).formattingRemoved).toBe(true);
  });

  it('bounds scanned nodes, retained witnesses and retained attribute units without changing a paste', () => {
    const state = EditorState.create({ schema, doc: schema.node('doc', null, [paragraph()]) });
    const cases = [
      new Slice(Fragment.from([paragraph('Marked', [bold]), ...Array.from({ length: 4096 }, () => paragraph())]), 0, 0),
      new Slice(Fragment.from(Array.from({ length: 129 }, (_, index) => paragraph(String(index), [bold]))), 0, 0),
      new Slice(Fragment.from(Array.from({ length: 5 }, (_, index) => paragraph(String(index), [schema.mark('textStyle', { fontFamily: 'x'.repeat(4096) })]))), 0, 0),
    ];
    for (const slice of cases) expect(createPasteContentWitness(slice, state)).toBeUndefined();
    expect(state.doc.textContent).toBe('');
  });
});
