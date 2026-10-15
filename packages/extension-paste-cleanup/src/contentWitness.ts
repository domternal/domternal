import type { Fragment, Mark, MarkType, Node as PMNode, NodeType, Slice } from '@domternal/pm/model';
import type { EditorState, Transaction } from '@domternal/pm/state';
import { AddMarkStep, AttrStep, DocAttrStep, RemoveMarkStep, ReplaceAroundStep, ReplaceStep } from '@domternal/pm/transform';

// This advisory check has its own small ceiling. Exceeding it never rejects or changes a paste.
const MAX_NODES = 4096;
const MAX_WITNESSES = 128;
const MAX_METADATA = 16384;
const MAX_DEPTH = 128;
const semanticMarks = new Set(['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript', 'code']);
const textAttributes = ['fontFamily', 'fontSize', 'color', 'colorToken', 'backgroundColor', 'backgroundColorToken'] as const;
const blockAttributes = ['textAlign', 'lineHeight', 'bgColor', 'backgroundColor', 'backgroundColorToken', 'listStyleType'] as const;

type Attributes = Readonly<Record<string, string>>;
interface ExpectedMark { readonly type: MarkType; readonly attrs: Attributes }
interface Format { readonly type: NodeType; readonly marks: readonly ExpectedMark[]; readonly attrs: Attributes }
interface PositionedFormat extends Format { readonly from: number; readonly to: number }
interface Seed {
  readonly doc: PMNode;
  readonly from: number;
  readonly to: number;
  readonly nodes: ReadonlyMap<PMNode, Format>;
}

/** An opaque, attempt-local identity. Source nodes never enter the public operation result. */
export interface PasteContentWitness { readonly identity: object }
export interface PasteContentLedger {
  readonly identity: object;
  readonly entries: readonly PositionedFormat[];
  readonly formattingRemoved: boolean;
}
const seeds = new WeakMap<PasteContentWitness, Seed>();
const openInsertions = new WeakMap<object, Transaction>();

/** Traverse only the supplied fragment, with bounded work and no recursion. */
function walk(fragment: Fragment, visit: (node: PMNode, position: number) => void): boolean {
  const stack = [{ content: fragment, index: 0, position: 0 }];
  let count = 0;
  while (stack.length > 0) {
    const frame = stack.at(-1);
    if (frame === undefined) break;
    if (frame.index === frame.content.childCount) { stack.pop(); continue; }
    if (++count > MAX_NODES || stack.length > MAX_DEPTH) return false;
    const node = frame.content.child(frame.index++);
    const position = frame.position;
    frame.position += node.nodeSize;
    visit(node, position);
    if (node.childCount > 0) stack.push({ content: node.content, index: 0, position: position + 1 });
  }
  return true;
}

function attributes(raw: Readonly<Record<string, unknown>>, names: readonly string[]): Attributes {
  const result: Record<string, string> = {};
  for (const name of names) {
    const value = raw[name];
    if (typeof value === 'string' && value.length > 0 && value.length <= 4096) result[name] = value;
  }
  return Object.freeze(result);
}

function marks(node: PMNode): readonly ExpectedMark[] {
  if (node.marks.length > 16) return [];
  const result: ExpectedMark[] = [];
  for (const mark of node.marks) {
    if (semanticMarks.has(mark.type.name)) result.push({ type: mark.type, attrs: Object.freeze({}) });
    else if (mark.type.name === 'textStyle' || mark.type.name === 'link') {
      const attrs = attributes(mark.attrs, mark.type.name === 'link' ? ['href'] : textAttributes);
      if (Object.keys(attrs).length > 0) result.push({ type: mark.type, attrs });
    }
    if (result.length > 16) return [];
  }
  return Object.freeze(result.map(mark => Object.freeze(mark)));
}

/**
 * Remember formatting on the actual parsed slice, after host HTML and slice transforms.
 * Repeated node identities are ambiguous and receive no witness. No text matching is used.
 */
export function createPasteContentWitness(slice: Slice, state: EditorState): PasteContentWitness | undefined {
  const nodes = new Map<PMNode, Format>();
  const duplicates = new Set<PMNode>();
  let metadata = 0;
  const budget = { exceeded: false };
  const complete = walk(slice.content, node => {
    if (budget.exceeded || duplicates.has(node)) return;
    if (nodes.has(node)) { nodes.delete(node); duplicates.add(node); return; }
    const expectedMarks = node.isText ? marks(node) : [];
    const attrs: Attributes = node.isBlock ? attributes(node.attrs,
      blockAttributes.filter(name => node.attrs[name] !== node.type.spec.attrs?.[name]?.default)) : Object.freeze({});
    if (expectedMarks.length === 0 && Object.keys(attrs).length === 0) return;
    metadata += Object.values(attrs).reduce((sum, value) => sum + value.length, 0);
    for (const mark of expectedMarks) metadata += Object.values(mark.attrs).reduce((sum, value) => sum + value.length, 0);
    if (nodes.size >= MAX_WITNESSES || metadata > MAX_METADATA) { budget.exceeded = true; return; }
    nodes.set(node, Object.freeze({ type: node.type, marks: expectedMarks, attrs }));
  });
  if (!complete || budget.exceeded || nodes.size === 0) return undefined;
  const witness = Object.freeze({ identity: Object.freeze({}) });
  seeds.set(witness, { doc: state.doc, from: state.selection.from, to: state.selection.to, nodes });
  // A later task cannot reuse a cancelled, vetoed or otherwise unconsumed source.
  queueMicrotask(() => { seeds.delete(witness); });
  return witness;
}

/** Only node identity within an accepted replacement establishes a source-to-document association. */
export function bindPasteContentWitness(value: unknown, transaction: Transaction): PasteContentLedger | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const seed = seeds.get(value as PasteContentWitness);
  const step = transaction.steps[0];
  if (seed?.doc !== transaction.before || transaction.steps.length !== 1 || !(step instanceof ReplaceStep) || step.constructor !== ReplaceStep
    || step.from > seed.from || step.to < seed.to || step.slice.size === 0) return undefined;
  const entries = new Map<PMNode, PositionedFormat>();
  const duplicates = new Set<PMNode>();
  const complete = walk(step.slice.content, (node, offset) => {
    const format = seed.nodes.get(node);
    if (format === undefined || duplicates.has(node)) return;
    if (entries.has(node)) { entries.delete(node); duplicates.add(node); return; }
    const from = step.from + offset - step.slice.openStart;
    const to = from + node.nodeSize;
    if (from < step.from || to > step.from + step.slice.size || transaction.doc.nodeAt(from) !== node) return;
    entries.set(node, Object.freeze({ ...format, from, to }));
  });
  if (!complete || entries.size === 0) return undefined;
  const identity = Object.freeze({});
  openInsertions.set(identity, transaction);
  queueMicrotask(() => { openInsertions.delete(identity); });
  return Object.freeze({ identity, entries: Object.freeze([...entries.values()]), formattingRemoved: false });
}

function retainedAttributes(expected: Attributes, actual: Readonly<Record<string, unknown>>, type: NodeType | MarkType): boolean {
  return Object.entries(expected).every(([name, value]) => {
    const current = actual[name];
    if (current === value) return true;
    // A different nonempty value may be an equivalent spelling or an intentional host adaptation.
    // This check proves removal, not semantic equivalence of CSS, links or theme tokens.
    const alternate = name === 'color' ? 'colorToken' : name === 'colorToken' ? 'color'
      : name === 'backgroundColor' ? 'backgroundColorToken' : name === 'backgroundColorToken' ? 'backgroundColor' : undefined;
    if (alternate !== undefined && typeof actual[alternate] === 'string' && actual[alternate] !== '') return true;
    return typeof current === 'string' && current !== '' && current !== type.spec.attrs?.[name]?.default;
  });
}

function retainedMarks(expected: readonly ExpectedMark[], actual: readonly Mark[]): boolean {
  return expected.every(mark => actual.some(candidate => candidate.type === mark.type && retainedAttributes(mark.attrs, candidate.attrs, candidate.type)));
}

function removed(doc: PMNode, entry: PositionedFormat, budget: { nodes: number }): boolean | undefined {
  if (Object.keys(entry.attrs).length > 0) {
    const node = doc.nodeAt(entry.from);
    if (node?.type !== entry.type || !retainedAttributes(entry.attrs, node.attrs, node.type)) return true;
  }
  if (entry.marks.length === 0) return false;
  let position = entry.from;
  let missing = false;
  while (position < entry.to) {
    if (++budget.nodes > MAX_NODES) return undefined;
    const node = doc.resolve(position).nodeAfter;
    if (node?.isText !== true) return undefined;
    missing ||= !retainedMarks(entry.marks, node.marks);
    position += Math.min(node.nodeSize, entry.to - position);
  }
  return missing;
}

/** The exact same-type wrapper replacement emitted by ProseMirror's setNodeMarkup. */
function changesOnlyMarkup(step: ReplaceAroundStep, before: PMNode | undefined): boolean {
  const previous = before?.nodeAt(step.from);
  const replacement = step.slice.content.firstChild;
  return previous !== undefined && previous !== null && !previous.isLeaf
    && step.to === step.from + previous.nodeSize
    && step.gapFrom === step.from + 1 && step.gapTo === step.to - 1 && step.insert === 1
    && step.slice.openStart === 0 && step.slice.openEnd === 0 && step.slice.content.childCount === 1
    && replacement?.type === previous.type && replacement.childCount === 0;
}

/**
 * Only accepted appended steps may update this ledger. Later independent edits and Undo
 * leave the completed paste's evidence alone. A replacement touching a witness is uncertain,
 * even when its text looks identical; it never becomes a fabricated loss or a fabricated match.
 */
export function advancePasteContentLedger(ledger: PasteContentLedger, transaction: Transaction): PasteContentLedger {
  const root = openInsertions.get(ledger.identity);
  if (root === undefined || transaction.getMeta('appendedTransaction') !== root) return ledger;
  let entries = [...ledger.entries];
  if (transaction.steps.length > MAX_NODES) entries = [];
  for (const [index, step] of transaction.steps.entries()) {
    if (entries.length === 0) break;
    if (step.constructor === AddMarkStep || step.constructor === RemoveMarkStep || step.constructor === AttrStep || step.constructor === DocAttrStep) continue;
    // Replacing just a node's markup keeps its exact content gap and every position unchanged.
    // UniqueID uses this built-in operation; arbitrary wrapping steps remain unverified.
    if (step instanceof ReplaceAroundStep && step.constructor === ReplaceAroundStep && changesOnlyMarkup(step, transaction.docs[index])) continue;
    if (!(step instanceof ReplaceStep) || step.constructor !== ReplaceStep) { entries = []; break; }
    const map = step.getMap();
    entries = entries.flatMap(entry => {
      const overlap = step.from === step.to
        ? step.from > entry.from && step.from < entry.to
        : step.from < entry.to && step.to > entry.from;
      if (overlap) return [];
      const from = map.map(entry.from, 1);
      const to = map.map(entry.to, -1);
      return from < to ? [Object.freeze({ ...entry, from, to })] : [];
    });
  }
  const budget = { nodes: 0 };
  let formattingRemoved = false;
  entries = entries.filter(entry => {
    const loss = removed(transaction.doc, entry, budget);
    formattingRemoved ||= loss === true;
    return loss !== undefined;
  });
  return Object.freeze({ identity: ledger.identity, entries: Object.freeze(entries), formattingRemoved });
}
