import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import type { Schema } from '@domternal/pm/model';
import { Editor } from '../Editor.js';
import { Node } from '../Node.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { ListItem } from '../nodes/ListItem.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { BulletList } from '../nodes/BulletList.js';
import { ExtensionManager } from '../ExtensionManager.js';
import { createDocument } from './createDocument.js';
import { normalizeContent } from './normalizeContent.js';
import { generateHTML, generateText } from './ssr.js';
import type { ContentDiagnostic, JSONAttribute, JSONContent } from '../types/index.js';

/** A third-party node that happens to declare its own listStyleType. */
const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'paragraph+',
  addAttributes: () => ({ listStyleType: { default: null } }),
  parseHTML: () => [{ tag: 'aside' }],
  renderHTML: () => ['aside', 0],
});
/** A renamed list reuses the built-in marker attribute and its validator. */
const Steps = OrderedList.extend({ name: 'steps' });
const extensions = [Document, Paragraph, Text, ListItem, OrderedList, BulletList, Callout, Steps];
const schema: Schema = new ExtensionManager({ extensions }, { state: null, view: null, schema: null, commands: {} } as never).schema;

const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const list = (marker: JSONAttribute, children: JSONContent[] = [paragraph('A')], type = 'orderedList'): JSONContent => ({
  type, attrs: { listStyleType: marker }, content: [{ type: 'listItem', content: children }],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const collect = (): { diagnostics: ContentDiagnostic[]; onDiagnostic: (diagnostic: ContentDiagnostic) => void } => {
  const diagnostics: ContentDiagnostic[] = [];
  return { diagnostics, onDiagnostic: diagnostic => diagnostics.push(diagnostic) };
};
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('normalizeContent', () => {
  it.each([
    ['orderedList', 7, 7],
    ['orderedList', {}, undefined],
    ['orderedList', '', ''],
    ['orderedList', 'DECIMAL', 'DECIMAL'],
    ['orderedList', 'circle', 'circle'],
    ['bulletList', 'decimal', 'decimal'],
    ['steps', 'var(--marker)', 'var(--marker)'],
  ])('replaces %s marker %j with null and reports it', (type, marker, value) => {
    const { diagnostics, onDiagnostic } = collect();
    const result = normalizeContent(doc(list(marker as JSONAttribute, undefined, type)), schema, { onDiagnostic });
    expect(result.content?.[0]?.attrs).toEqual({ listStyleType: null });
    expect(() => schema.nodeFromJSON(result)).not.toThrow();
    expect(diagnostics).toEqual([{
      code: 'unknown-list-marker', nodeType: type, attribute: 'listStyleType', path: [0],
      ...(value === undefined ? {} : { value }),
    }]);
    expect(Object.isFrozen(diagnostics[0])).toBe(true);
  });

  it('returns the same reference with no diagnostic for known, null and absent markers', () => {
    const onDiagnostic = vi.fn();
    const content = doc(
      list('upper-roman'), list('square', undefined, 'bulletList'), list(null),
      { type: 'orderedList', content: [{ type: 'listItem', content: [paragraph('B')] }] },
      { type: 'callout', attrs: { listStyleType: 'bogus' }, content: [paragraph('C')] },
    );
    expect(normalizeContent(content, schema, { onDiagnostic })).toBe(content);
    expect(normalizeContent([list('lower-alpha')], schema, { onDiagnostic })[0]).toBeDefined();
    expect(onDiagnostic).not.toHaveBeenCalled();
  });

  it('copies on write without touching a frozen input', () => {
    const untouched = paragraph('same');
    const nested = list('weird', undefined, 'bulletList');
    const content = deepFreeze(doc(untouched, list('bogus', [paragraph('A'), nested])));
    const snapshot = JSON.stringify(content);
    const { diagnostics, onDiagnostic } = collect();
    const result = normalizeContent(content, schema, { onDiagnostic });
    expect(JSON.stringify(content)).toBe(snapshot);
    expect(result).not.toBe(content);
    expect(result.content?.[0]).toBe(untouched);
    const item = result.content?.[1]?.content?.[0];
    expect(item?.content?.[0]).toBe(content.content?.[1]?.content?.[0]?.content?.[0]);
    expect(item?.content?.[1]?.attrs).toEqual({ listStyleType: null });
    expect(diagnostics.map(({ nodeType, path }) => [nodeType, path])).toEqual([
      ['orderedList', [1]],
      ['bulletList', [1, 0, 1]],
    ]);
  });

  it('normalizes arrays with paths relative to the array', () => {
    const { diagnostics, onDiagnostic } = collect();
    const result = normalizeContent([paragraph('x'), list('bogus')], schema, { onDiagnostic });
    expect(result[1]?.attrs).toEqual({ listStyleType: null });
    expect(diagnostics[0]?.path).toEqual([1]);
  });

  it('normalizes everything but reports at most 100 diagnostics per call', () => {
    const { diagnostics, onDiagnostic } = collect();
    const result = normalizeContent(doc(...Array.from({ length: 150 }, () => list('bogus'))), schema, { onDiagnostic });
    expect(result.content?.every(node => node.attrs?.['listStyleType'] === null)).toBe(true);
    expect(diagnostics).toHaveLength(100);
  });

  it('keeps normalizing when the diagnostic callback throws', () => {
    const onDiagnostic = vi.fn(() => { throw new Error('callback'); });
    const result = normalizeContent(doc(list('bogus'), list('weird')), schema, { onDiagnostic });
    expect(result.content?.map(node => node.attrs?.['listStyleType'])).toEqual([null, null]);
    expect(onDiagnostic).toHaveBeenCalledTimes(2);
  });

  it('reports a short string value only', () => {
    const { diagnostics, onDiagnostic } = collect();
    normalizeContent(doc(list('x'.repeat(64)), list('y'.repeat(65))), schema, { onDiagnostic });
    expect(diagnostics[0]?.value).toBe('x'.repeat(64));
    expect(diagnostics[1]).not.toHaveProperty('value');
  });

  it('leaves malformed nodes for fromJSON to reject', () => {
    const malformed = [null, 'text', { type: 'orderedList', attrs: { listStyleType: 'bogus' }, content: 'x' }] as unknown as JSONContent[];
    const result = normalizeContent(malformed, schema);
    expect(result[0]).toBeNull();
    expect(result[1]).toBe('text');
    expect(result[2]?.attrs).toEqual({ listStyleType: null });
    expect(result[2]?.content).toBe('x');
    const unknownType = doc({ type: 'nonexistent', attrs: { listStyleType: 'bogus' } });
    expect(normalizeContent(unknownType, schema)).toBe(unknownType);
  });
});

describe('createDocument with unknown list markers', () => {
  it('builds the document with a null marker and reports it', () => {
    const { diagnostics, onDiagnostic } = collect();
    const input = doc(list('bogus'), paragraph('tail'));
    const result = createDocument(input, schema, { onDiagnostic });
    expect(result.firstChild?.attrs['listStyleType']).toBeNull();
    expect(result.textContent).toBe('Atail');
    expect(diagnostics).toEqual([{ code: 'unknown-list-marker', nodeType: 'orderedList', attribute: 'listStyleType', path: [0], value: 'bogus' }]);
    expect(input.content?.[0]?.attrs?.['listStyleType']).toBe('bogus');
    expect(() => createDocument(input, schema)).not.toThrow();
  });

  it('reports nothing when the document still fails to load', () => {
    const onDiagnostic = vi.fn();
    expect(() => createDocument(doc(list('bogus'), { type: 'nonexistent' }), schema, { onDiagnostic })).toThrow();
    expect(onDiagnostic).not.toHaveBeenCalled();
  });
});

describe('SSR helpers with unknown list markers', () => {
  const ssrExtensions = [Document, Paragraph, Text, OrderedList, BulletList];
  const content = doc(list('bogus'), list('decimal', [paragraph('B')], 'bulletList'));

  it.each([
    ['jsdom', () => document],
    ['linkedom', () => parseHTML('<!DOCTYPE html><html><body></body></html>').document],
  ])('generateHTML renders the default marker under %s', (_name, target) => {
    const { diagnostics, onDiagnostic } = collect();
    expect(generateHTML(content, ssrExtensions, { document: target(), onDiagnostic }))
      .toBe('<ol><li><p>A</p></li></ol><ul><li><p>B</p></li></ul>');
    expect(diagnostics.map(({ nodeType, value }) => [nodeType, value])).toEqual([['orderedList', 'bogus'], ['bulletList', 'decimal']]);
    expect(generateHTML(content, ssrExtensions)).toBe('<ol><li><p>A</p></li></ol><ul><li><p>B</p></li></ul>');
  });

  it('generateText extracts the text and reports', () => {
    const { diagnostics, onDiagnostic } = collect();
    expect(generateText(content, ssrExtensions, { onDiagnostic })).toBe('A\n\nB');
    expect(generateText(content, ssrExtensions)).toBe('A\n\nB');
    expect(diagnostics).toHaveLength(2);
  });

  it('still rejects input that is not JSON content', () => {
    const notJSON = (value: unknown): JSONContent => value as JSONContent;
    expect(() => generateHTML(notJSON(null), ssrExtensions)).toThrow('Invalid input for Node.fromJSON');
    expect(() => generateText(notJSON(null), ssrExtensions)).toThrow('Invalid input for Node.fromJSON');
    expect(() => generateHTML(notJSON('<p>x</p>'), ssrExtensions)).toThrow('Unknown node type');
  });
});

describe('validation stays strict outside the normalizing entry points', () => {
  const orderedList = schema.nodes['orderedList'];
  const item = (): ReturnType<typeof schema.node> => schema.node('listItem', null, [schema.node('paragraph', null, [schema.text('A')])]);

  it('nodeFromJSON and Node.check still reject an unknown marker', () => {
    expect(() => schema.nodeFromJSON(doc(list('bogus')))).toThrow('Invalid list marker');
    expect(() => orderedList?.create({ listStyleType: 'bogus' }, item()).check()).toThrow('Invalid list marker');
  });

  it('node creation never validates, so a bound collaborative document is never rebuilt without a node', () => {
    expect(schema.node('orderedList', { listStyleType: 'bogus' }, [item()]).attrs['listStyleType']).toBe('bogus');
    expect(orderedList?.createChecked({ listStyleType: 'bogus' }, item()).attrs['listStyleType']).toBe('bogus');
    expect(orderedList?.createAndFill({ listStyleType: 'bogus' })?.attrs['listStyleType']).toBe('bogus');
  });
});

describe('rendering a state that already holds an unknown marker', () => {
  let editor: Editor | undefined;
  afterEach(() => { editor?.destroy(); editor = undefined; });

  it('renders the default marker in the view, getHTML and styled HTML without rewriting state', () => {
    editor = new Editor({ extensions: [Document, Paragraph, Text, OrderedList, BulletList], content: '<ol><li><p>A</p></li></ol>' });
    editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'listStyleType', 'bogus'));
    expect(editor.state.doc.firstChild?.attrs['listStyleType']).toBe('bogus');
    expect(editor.view.dom.querySelector('ol')?.hasAttribute('style')).toBe(false);
    expect(editor.getHTML()).toBe('<ol><li><p>A</p></li></ol>');
    const styled = document.createElement('div');
    styled.innerHTML = editor.getHTML({ styled: true });
    expect(styled.querySelector('ol')?.style.listStyleType).toBe('decimal');
    editor.view.dispatch(editor.state.tr.insertText('!', 3));
    expect(editor.state.doc.firstChild?.attrs['listStyleType']).toBe('bogus');
  });
});
