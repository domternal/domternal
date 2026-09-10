/**
 * normalizeContentAttributes({ codes }) replaces only values reported with the chosen
 * diagnostic codes, so the repairs that are the same for every version and configuration
 * can run while other clients still support the other values.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { ListItem } from '../nodes/ListItem.js';
import { Heading } from '../nodes/Heading.js';
import { Link } from '../marks/Link.js';
import { History } from '../extensions/History.js';
import type { ContentDiagnosticProps } from '../types/index.js';

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

/**
 * A document holding one value of each code, stored the way a bound collaborative document
 * holds them: without validation or history. The ftp: link is what a writer that allows
 * ftp: links stores.
 */
function mount(): { editor: Editor; reports: ContentDiagnosticProps[] } {
  const reports: ContentDiagnosticProps[] = [];
  const ed = new Editor({
    extensions: [Document, Paragraph, Text, OrderedList, ListItem, Heading, Link, History],
    content: '<ol><li><p>A</p></li></ol><h4>H</h4><p>ftp ok js</p>',
    onContentDiagnostic: props => { reports.push(props); },
  });
  editor = ed;
  const hrefs: Record<string, string> = { ftp: 'ftp://files.example/f', ok: 'https://example.com/', js: 'javascript:alert(1)' };
  const linkType = ed.schema.marks['link'];
  if (!linkType) throw new Error('The schema has no link mark');
  const tr = ed.state.tr.setMeta('addToHistory', false);
  ed.state.doc.descendants((node, pos) => {
    if (node.type.name === 'orderedList') tr.setNodeAttribute(pos, 'listStyleType', 'bogus');
    if (node.type.name === 'heading') tr.setNodeAttribute(pos, 'level', 6);
    if (node.isText && node.text === 'ftp ok js') {
      let offset = pos;
      for (const word of ['ftp', 'ok', 'js']) {
        tr.addMark(offset, offset + word.length, linkType.create({ href: hrefs[word] }));
        offset += word.length + 1;
      }
    }
  });
  ed.view.dispatch(tr);
  reports.length = 0;
  return { editor: ed, reports };
}

function stored(ed: Editor): { marker: unknown; level: unknown; hrefs: unknown[] } {
  const found = { marker: undefined as unknown, level: undefined as unknown, hrefs: [] as unknown[] };
  ed.state.doc.descendants(node => {
    if (node.type.name === 'orderedList') found.marker = node.attrs['listStyleType'];
    if (node.type.name === 'heading') found.level = node.attrs['level'];
    for (const mark of node.marks) if (mark.type.name === 'link') found.hrefs.push(mark.attrs['href']);
  });
  return found;
}

describe('normalizeContentAttributes with codes', () => {
  it('holds one value of every code before migration', () => {
    const { editor: ed } = mount();
    expect(stored(ed)).toEqual({ marker: 'bogus', level: 6, hrefs: ['ftp://files.example/f', 'https://example.com/', 'javascript:alert(1)'] });
  });

  it('replaces only the values of the chosen code and reports only those', () => {
    const { editor: ed, reports } = mount();

    expect(ed.can().normalizeContentAttributes({ codes: ['unsafe-url'] })).toBe(true);
    expect(ed.commands.normalizeContentAttributes({ codes: ['unsafe-url'] })).toBe(true);

    expect(stored(ed)).toEqual({ marker: 'bogus', level: 6, hrefs: ['ftp://files.example/f', 'https://example.com/'] });
    expect(ed.getText()).toContain('js');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ source: 'normalizeContentAttributes', total: 1 });
    expect(reports[0]?.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['unsafe-url']);
    expect(ed.can().normalizeContentAttributes({ codes: ['unsafe-url'] })).toBe(false);
  });

  it('tells a link the policy refuses by its code: unsupported-url leaves unsafe links alone', () => {
    const { editor: ed } = mount();

    expect(ed.commands.normalizeContentAttributes({ codes: ['unsupported-url'] })).toBe(true);

    expect(stored(ed).hrefs).toEqual(['https://example.com/', 'javascript:alert(1)']);
  });

  it('replaces the values of several codes in one step', () => {
    const { editor: ed, reports } = mount();

    expect(ed.commands.normalizeContentAttributes({ codes: ['unknown-list-marker', 'unsupported-heading-level'] })).toBe(true);

    expect(stored(ed)).toMatchObject({ marker: null, level: 4 });
    expect(stored(ed).hrefs).toHaveLength(3);
    expect(reports[0]?.diagnostics.map(diagnostic => diagnostic.code).sort()).toEqual(['unknown-list-marker', 'unsupported-heading-level']);
  });

  it('returns false and changes nothing for a code no value has, or for an empty list', () => {
    const { editor: ed, reports } = mount();
    const before = ed.state;

    expect(ed.can().normalizeContentAttributes({ codes: ['unsupported-table-span'] })).toBe(false);
    expect(ed.commands.normalizeContentAttributes({ codes: ['unsupported-table-span'] })).toBe(false);
    expect(ed.commands.normalizeContentAttributes({ codes: [] })).toBe(false);

    expect(ed.state).toBe(before);
    expect(reports).toEqual([]);
  });

  it('replaces every value without codes, after a partial migration too', () => {
    const { editor: ed } = mount();
    ed.commands.normalizeContentAttributes({ codes: ['unsafe-url'] });

    expect(ed.commands.normalizeContentAttributes()).toBe(true);

    expect(stored(ed)).toEqual({ marker: null, level: 4, hrefs: ['https://example.com/'] });
    expect(ed.can().normalizeContentAttributes()).toBe(false);
  });

  it('keeps a chained migration out of the undo history as the unfiltered one does', () => {
    const { editor: ed } = mount();

    expect(ed.chain().normalizeContentAttributes({ codes: ['unknown-list-marker'] }).run()).toBe(true);

    expect(stored(ed).marker).toBeNull();
    expect(ed.can().undo()).toBe(false);
  });
});
